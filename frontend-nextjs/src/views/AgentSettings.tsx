'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import AdminLayout from '../components/AdminLayout';
import ProcedureEditor from '../components/ProcedureEditor';
import { Icon } from '../components/Icon';
import {
  api,
  type Agent,
  type BusinessHoursPayload,
  type WidgetCard,
  type WidgetStarter,
} from '../services/api';
import {
  validateAllowedWidgetOriginsText,
} from '../lib/widgetOrigins';
import { buildWidgetEmbedCode, isLoopbackOrigin } from '../lib/widgetEmbedCode';
import { useIsMobile } from '../hooks/useMediaQuery';

interface AgentSettingsFormData {
  widget_title: string;
  widget_color: string;
  welcome_message: string;
  history_days: number;
  allowed_widget_origins: string[];
  rate_limit_per_minute: number;
  restricted_reply: string;
}

/** #40: the three install modes. `bubble` is today's behaviour. */
type DisplayMode = 'bubble' | 'inline' | 'iframe';

/** #40: a starter row in the editor; every field is a string so the inputs stay controlled. */
interface StarterRow {
  label: string;
  action: 'message' | 'link';
  value: string;
  path: string;
}

/** #40: a card row in the editor. */
interface CardRow {
  logo: string;
  heading: string;
  text: string;
  action: string;
}

const DEFAULT_TRAFFIC_PERCENTAGE = 100;

function emptyStarterRow(): StarterRow {
  return { label: '', action: 'message', value: '', path: '' };
}

function emptyCardRow(): CardRow {
  return { logo: '', heading: '', text: '', action: '' };
}

function startersFromAgent(agent: Agent): StarterRow[] {
  const raw = agent.starters ?? [];
  if (!Array.isArray(raw) || raw.length === 0) return [];
  return raw.map((starter) => ({
    label: typeof starter?.label === 'string' ? starter.label : '',
    action: starter?.action === 'link' ? 'link' : 'message',
    value: typeof starter?.value === 'string'
      ? starter.value
      : (typeof starter?.url === 'string' ? starter.url : ''),
    path: typeof starter?.path === 'string' ? starter.path : '',
  }));
}

function cardsFromAgent(agent: Agent): CardRow[] {
  const raw = agent.widget_cards ?? [];
  if (!Array.isArray(raw) || raw.length === 0) return [];
  return raw.map((card) => ({
    logo: typeof card?.logo === 'string' ? card.logo : '',
    heading: typeof card?.heading === 'string' ? card.heading : '',
    text: typeof card?.text === 'string' ? card.text : '',
    action:
      (typeof card?.chat === 'string' && card.chat) ||
      (typeof card?.kb_search === 'string' && card.kb_search) ||
      (typeof card?.form === 'string' && card.form) ||
      '',
  }));
}

/** An empty row is dropped on save; a half-filled one is kept (the operator is mid-edit). */
function isRowEmpty(row: StarterRow | CardRow): boolean {
  return Object.values(row).every((value) => String(value).trim() === '');
}

/**
 * A regex the widget will actually have to compile. An invalid one is reported
 * here rather than silently shipped, but it never blocks the save — the widget
 * ignores bad patterns at runtime with a warning.
 */
function findInvalidPatterns(values: string[]): string[] {
  const invalid: string[] = [];
  for (const value of values) {
    if (!value.trim()) continue;
    try {
      new RegExp(value);
    } catch {
      invalid.push(value);
    }
  }
  return invalid;
}

/** Contract C6: `day` 0 = Monday, `start`/`end` are minutes from local midnight. */
interface BusinessHoursRange {
  day: number;
  start: number;
  end: number;
}

interface BusinessHoursConfig {
  timezone: string;
  schedule: BusinessHoursRange[];
}

const DEFAULT_WIDGET_COLOR = '#00aaff';
const DEFAULT_HISTORY_DAYS = 30;

/** 09:00–18:00, the shape most operators start from. */
const DEFAULT_START_MINUTES = 9 * 60;
const DEFAULT_END_MINUTES = 18 * 60;
const MINUTES_PER_DAY = 24 * 60;

function minutesToTimeInput(minutes: number): string {
  const clamped = Math.max(0, Math.min(MINUTES_PER_DAY, Math.round(minutes)));
  const hours = Math.floor(clamped / 60);
  const mins = clamped % 60;
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}

function timeInputToMinutes(value: string): number {
  const [hours, minutes] = value.split(':');
  const parsedHours = Number.parseInt(hours ?? '0', 10);
  const parsedMinutes = Number.parseInt(minutes ?? '0', 10);
  if (Number.isNaN(parsedHours) || Number.isNaN(parsedMinutes)) return 0;
  return Math.max(0, Math.min(MINUTES_PER_DAY, parsedHours * 60 + parsedMinutes));
}

/** `Intl.supportedValuesOf('timeZone')` where available, a short fallback list otherwise. */
const FALLBACK_TIMEZONES = [
  'UTC',
  'Asia/Shanghai',
  'Asia/Hong_Kong',
  'Asia/Tokyo',
  'Asia/Singapore',
  'Europe/London',
  'Europe/Paris',
  'America/New_York',
  'America/Los_Angeles',
  'Australia/Sydney',
];

function supportedTimezones(): string[] {
  const intl = Intl as typeof Intl & {
    supportedValuesOf?: (key: string) => string[];
  };
  if (typeof intl.supportedValuesOf === 'function') {
    try {
      const zones = intl.supportedValuesOf('timeZone');
      if (Array.isArray(zones) && zones.length > 0) return zones;
    } catch {
      // Older engines throw on an unknown key; fall through to the list.
    }
  }
  return FALLBACK_TIMEZONES;
}

function parseLines(value: string): string[] {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

/**
 * Coerce whatever the backend stored into the editor's shape.
 *
 * An unparsable/absent config becomes `null` — "no hours configured", which the
 * backend treats as always online — instead of an empty schedule that would read
 * as "closed all week".
 */
function normalizeBusinessHours(
  raw: BusinessHoursPayload | null | undefined,
): BusinessHoursConfig | null {
  if (!raw || typeof raw !== 'object') return null;
  const timezone = typeof raw.timezone === 'string' ? raw.timezone : '';
  if (!timezone) return null;

  const rawSchedule = Array.isArray(raw.schedule) ? raw.schedule : [];
  const schedule: BusinessHoursRange[] = [];
  for (const entry of rawSchedule) {
    if (!entry || typeof entry !== 'object') continue;
    const item = entry as Record<string, unknown>;
    const day = Number(item.day);
    const start = Number(item.start);
    const end = Number(item.end);
    if (!Number.isFinite(day) || !Number.isFinite(start) || !Number.isFinite(end)) {
      continue;
    }
    schedule.push({
      day: Math.max(0, Math.min(6, Math.trunc(day))),
      start: Math.max(0, Math.min(MINUTES_PER_DAY, Math.trunc(start))),
      end: Math.max(0, Math.min(MINUTES_PER_DAY, Math.trunc(end))),
    });
  }

  return { timezone, schedule };
}

function formDataFromAgent(agent: Agent): AgentSettingsFormData {
  return {
    widget_title: agent.widget_title || '',
    widget_color: agent.widget_color || DEFAULT_WIDGET_COLOR,
    welcome_message: agent.welcome_message || '',
    history_days: agent.history_days || DEFAULT_HISTORY_DAYS,
    allowed_widget_origins: agent.allowed_widget_origins || [],
    rate_limit_per_minute: agent.rate_limit_per_minute ?? agent.rate_limit_per_hour ?? 20,
    restricted_reply: agent.restricted_reply ?? '',
  };
}

export default function AgentSettings() {
  const { t } = useTranslation('common');
  const { agentId: routeAgentId } = useParams<{ agentId?: string }>();
  const isMobile = useIsMobile();

  const [agent, setAgent] = useState<Agent | null>(null);
  const [formData, setFormData] = useState<AgentSettingsFormData | null>(null);
  const [originsText, setOriginsText] = useState<string>('');
  const [fixedFacts, setFixedFacts] = useState<string>('');
  const [fixedFactsSaving, setFixedFactsSaving] = useState(false);
  const [fixedFactsSaved, setFixedFactsSaved] = useState(false);
  const [fixedFactsError, setFixedFactsError] = useState<string | null>(null);
  // #43 conversation policy: a plain-language prompt block plus business hours.
  const [escalationRules, setEscalationRules] = useState<string>('');
  const [businessHours, setBusinessHours] = useState<BusinessHoursConfig | null>(null);
  const [awayMessage, setAwayMessage] = useState<string>('');
  // #40 install surface: the server-rendered loader's inputs.
  const [publicOrigin, setPublicOrigin] = useState<string | null>(null);
  const [publicOriginLoading, setPublicOriginLoading] = useState(true);
  const [embedCopied, setEmbedCopied] = useState(false);
  const [embedCopyError, setEmbedCopyError] = useState<string | null>(null);
  const [displayMode, setDisplayMode] = useState<DisplayMode>('bubble');
  const [inlineContainer, setInlineContainer] = useState<string>('');
  const [excludedPathsText, setExcludedPathsText] = useState<string>('');
  const [trafficPercentage, setTrafficPercentage] = useState<number>(
    DEFAULT_TRAFFIC_PERCENTAGE,
  );
  const [starterRows, setStarterRows] = useState<StarterRow[]>([]);
  const [cardRows, setCardRows] = useState<CardRow[]>([]);
  const timezoneOptions = useMemo(() => supportedTimezones(), []);
  // `businessHours.days` is an array in both locale files; i18next hands back
  // the raw value with `returnObjects`.
  const weekdayLabels = useMemo(() => {
    const labels = t('businessHours.days', { returnObjects: true });
    return Array.isArray(labels) ? (labels as string[]) : [];
  }, [t]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    loadAgent();
  }, [routeAgentId]);

  const loadAgent = async () => {
    setLoading(true);
    setError(null);
    try {
      let loadedAgent: Agent;
      if (routeAgentId) {
        loadedAgent = await api.getAgent(routeAgentId);
      } else {
        loadedAgent = await api.getDefaultAgent();
      }
      setAgent(loadedAgent);
      const data = formDataFromAgent(loadedAgent);
      setFormData(data);
      setOriginsText(data.allowed_widget_origins.join('\n'));
      setFixedFacts(loadedAgent.fixed_facts ?? '');
      setEscalationRules(loadedAgent.escalation_rules ?? '');
      setBusinessHours(normalizeBusinessHours(loadedAgent.business_hours ?? null));
      setAwayMessage(loadedAgent.away_message ?? '');
      // #40 install surface.
      setDisplayMode(
        loadedAgent.display_mode === 'inline' || loadedAgent.display_mode === 'iframe'
          ? loadedAgent.display_mode
          : 'bubble',
      );
      setInlineContainer(loadedAgent.inline_container ?? '');
      setExcludedPathsText((loadedAgent.excluded_paths ?? []).join('\n'));
      const percentage = loadedAgent.traffic_percentage;
      setTrafficPercentage(
        typeof percentage === 'number' && Number.isFinite(percentage)
          ? Math.max(0, Math.min(100, Math.round(percentage)))
          : DEFAULT_TRAFFIC_PERCENTAGE,
      );
      setStarterRows(startersFromAgent(loadedAgent));
      setCardRows(cardsFromAgent(loadedAgent));

      // The embed code must come from the SERVER, never from
      // `window.location.origin`: a dashboard opened on localhost would hand
      // out a localhost snippet, which is the bug #40 fixes.
      setPublicOriginLoading(true);
      try {
        const origin = await api.getPublicOrigin(loadedAgent.id);
        setPublicOrigin(origin ?? null);
      } catch {
        setPublicOrigin(null);
      } finally {
        setPublicOriginLoading(false);
      }
    } catch (err) {
      setError(t('errors.loadFailed'));
    } finally {
      setLoading(false);
    }
  };

  // #40: one script tag pointing at the server-rendered loader. `publicOrigin`
  // comes from `/config:public`, so the snippet is right even on localhost.
  const embedCode = useMemo(() => {
    if (!agent) return '';
    return buildWidgetEmbedCode(agent.id, publicOrigin);
  }, [agent, publicOrigin]);

  const handleCopyEmbedCode = async () => {
    if (!embedCode) return;
    setEmbedCopyError(null);
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(embedCode);
      } else {
        // Older/insecure contexts: the same fallback the rest of the app uses.
        const textArea = document.createElement('textarea');
        textArea.value = embedCode;
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
      }
      setEmbedCopied(true);
      setTimeout(() => setEmbedCopied(false), 2000);
    } catch {
      setEmbedCopyError(t('install.copyFailed'));
    }
  };

  const handleSave = async () => {
    if (!agent || !formData) return;

    // Validate origins
    const { normalizedOrigins, invalidOrigins } = validateAllowedWidgetOriginsText(originsText);
    if (invalidOrigins.length > 0) {
      setValidationError(t('labels.embedWhitelistInvalid', { origins: invalidOrigins.join(', ') }));
      return;
    }
    setValidationError(null);

    // #40: an excluded path or a starter path that will not compile is reported
    // here instead of being shipped to every visitor's browser.
    const invalidPathPatterns = findInvalidPatterns([
      ...parseLines(excludedPathsText),
      ...starterRows.map((row) => row.path),
    ]);
    if (invalidPathPatterns.length > 0) {
      setValidationError(
        t('install.excludedPathsInvalid', { paths: invalidPathPatterns.join(', ') }),
      );
      return;
    }

    const excludedPaths = parseLines(excludedPathsText);
    const starters: WidgetStarter[] = starterRows
      .filter((row) => !isRowEmpty(row) && row.label.trim())
      .map((row) => ({
        label: row.label.trim(),
        action: row.action,
        value: row.value.trim(),
        path: row.path.trim() ? row.path.trim() : undefined,
      }));
    const cards: WidgetCard[] = cardRows
      .filter((row) => !isRowEmpty(row))
      .map((row) => ({
        logo: row.logo.trim() ? row.logo.trim() : undefined,
        heading: row.heading.trim() ? row.heading.trim() : undefined,
        text: row.text.trim() ? row.text.trim() : undefined,
        chat: row.action.trim() ? row.action.trim() : undefined,
      }));

    setSaving(true);
    try {
      const updates: Partial<Agent> = {
        widget_title: formData.widget_title,
        widget_color: formData.widget_color,
        welcome_message: formData.welcome_message,
        history_days: formData.history_days,
        allowed_widget_origins: normalizedOrigins,
        rate_limit_per_minute: typeof formData.rate_limit_per_minute === 'number' ? formData.rate_limit_per_minute : 20,
        restricted_reply: formData.restricted_reply ?? '',
        escalation_rules: escalationRules.trim() ? escalationRules.trim() : null,
        business_hours: businessHours,
        away_message: awayMessage.trim() ? awayMessage.trim() : null,
        // #40: the install surface rides the same save.
        display_mode: displayMode,
        inline_container: inlineContainer.trim() ? inlineContainer.trim() : null,
        excluded_paths: excludedPaths,
        traffic_percentage: trafficPercentage,
        starters: starters,
        widget_cards: cards,
      };
      const updatedAgent = await api.updateAgent(agent.id, updates);
      setAgent(updatedAgent);
      setFormData(formDataFromAgent(updatedAgent));
      setEscalationRules(updatedAgent.escalation_rules ?? '');
      setBusinessHours(normalizeBusinessHours(updatedAgent.business_hours ?? null));
      setAwayMessage(updatedAgent.away_message ?? '');
      setOriginsText(normalizedOrigins.join('\n'));
      setStarterRows(startersFromAgent(updatedAgent));
      setCardRows(cardsFromAgent(updatedAgent));
      setExcludedPathsText((updatedAgent.excluded_paths ?? []).join('\n'));
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(t('errors.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const updateField = <K extends keyof AgentSettingsFormData>(field: K, value: AgentSettingsFormData[K]) => {
    if (!formData) return;
    setFormData({ ...formData, [field]: value });
    setValidationError(null);
  };

  /**
   * Fixed facts are their own PUT (`/agents/{id}/fixed-facts`), not part of the
   * agent PATCH: they are injected into every prompt ahead of the KB passages,
   * so they get an explicit save instead of riding the general form.
   */
  const handleSaveFixedFacts = async () => {
    if (!agent || fixedFactsSaving) return;
    setFixedFactsSaving(true);
    setFixedFactsError(null);
    try {
      const result = await api.updateFixedFacts(
        agent.id,
        fixedFacts.trim() ? fixedFacts : null,
      );
      setFixedFacts(result.fixed_facts ?? '');
      setFixedFactsSaved(true);
      setTimeout(() => setFixedFactsSaved(false), 2000);
    } catch (err) {
      setFixedFactsError(t('errors.saveFailed'));
    } finally {
      setFixedFactsSaving(false);
    }
  };

  /**
   * #43 business-hours editor. The config is `null` until the operator picks a
   * timezone, which is what the backend reads as "always online".
   */
  const updateBusinessHours = (next: BusinessHoursConfig | null) => {
    setBusinessHours(next);
    setValidationError(null);
  };

  const handleTimezoneChange = (timezone: string) => {
    if (!timezone) {
      updateBusinessHours(null);
      return;
    }
    updateBusinessHours({
      timezone,
      schedule: businessHours?.schedule ?? [],
    });
  };

  const handleAddRange = () => {
    if (!businessHours) return;
    updateBusinessHours({
      ...businessHours,
      schedule: [
        ...businessHours.schedule,
        { day: 0, start: DEFAULT_START_MINUTES, end: DEFAULT_END_MINUTES },
      ],
    });
  };

  const handleUpdateRange = (
    index: number,
    patch: Partial<BusinessHoursRange>,
  ) => {
    if (!businessHours) return;
    updateBusinessHours({
      ...businessHours,
      schedule: businessHours.schedule.map((range, position) =>
        position === index ? { ...range, ...patch } : range,
      ),
    });
  };

  const handleRemoveRange = (index: number) => {
    if (!businessHours) return;
    updateBusinessHours({
      ...businessHours,
      schedule: businessHours.schedule.filter((_range, position) => position !== index),
    });
  };

  // --- #40: repeatable starter / card rows (add + remove, no drag-and-drop) ---

  const updateStarterRow = (index: number, patch: Partial<StarterRow>) => {
    setStarterRows((rows) =>
      rows.map((row, position) => (position === index ? { ...row, ...patch } : row)),
    );
  };

  const handleAddStarter = () => {
    setStarterRows((rows) => [...rows, emptyStarterRow()]);
  };

  const handleRemoveStarter = (index: number) => {
    setStarterRows((rows) => rows.filter((_row, position) => position !== index));
  };

  const updateCardRow = (index: number, patch: Partial<CardRow>) => {
    setCardRows((rows) =>
      rows.map((row, position) => (position === index ? { ...row, ...patch } : row)),
    );
  };

  const handleAddCard = () => {
    setCardRows((rows) => [...rows, emptyCardRow()]);
  };

  const handleRemoveCard = (index: number) => {
    setCardRows((rows) => rows.filter((_row, position) => position !== index));
  };

  if (loading) {
    return (
      <AdminLayout>
        <div className="admin-page">
          <p className="field-hint" role="status">
            {t('status.loading')}
          </p>
          <div className="list" aria-busy="true">
            {[0, 1, 2].map((index) => (
              <div key={index} className="list-row">
                <div className="skeleton skeleton-text" style={{ width: '100%' }} />
              </div>
            ))}
          </div>
        </div>
      </AdminLayout>
    );
  }

  if (error && !agent) {
    return (
      <AdminLayout>
        <div className="admin-page">
          <div className="empty">
            <p className="empty-title" role="alert">
              {error}
            </p>
          </div>
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
      <div className="admin-page" data-testid="agent-settings-page">
        <header className="page-header">
          <div style={{ minWidth: 0 }}>
            <h1 className="page-title">{t('navigation.agentSettings')}</h1>
            <p className="page-subtitle">{t('labels.configAgentSettings')}</p>
          </div>
          <div className="page-actions">
            <button
              type="button"
              className="btn btn-primary btn-icon"
              onClick={handleSave}
              disabled={saving}
              aria-label={t('buttons.save')}
              title={saving ? t('status.saving') : t('buttons.save')}
              aria-busy={saving}
            >
              {saving ? (
                <div className="spinner" style={{ width: '14px', height: '14px' }} />
              ) : (
                <Icon name="save" size={16} />
              )}
            </button>
          </div>
        </header>

        {validationError && (
          <div
            role="alert"
            style={{
              padding: 'var(--space-3) var(--space-4)',
              marginBottom: 'var(--space-4)',
              background: 'var(--color-error-bg)',
              border: '1px solid var(--color-error)',
              borderRadius: 'var(--radius-md)',
              color: 'var(--color-error)',
              fontSize: 'var(--text-sm)',
              lineHeight: 'var(--leading-normal)',
            }}
          >
            {validationError}
          </div>
        )}

        {saved && (
          <div
            role="status"
            aria-live="polite"
            style={{
              padding: 'var(--space-3) var(--space-4)',
              marginBottom: 'var(--space-4)',
              background: 'var(--color-success-bg)',
              border: '1px solid var(--color-success)',
              borderRadius: 'var(--radius-md)',
              color: 'var(--color-success)',
              fontSize: 'var(--text-sm)',
              lineHeight: 'var(--leading-normal)',
            }}
          >
            {t('labels.settingsSaved')}
          </div>
        )}

        {/* Widget appearance + embed code */}
        <section className="card">
          <div className="card-header">
            <h2 className="card-title">{t('settings.widgetSettings')}</h2>
          </div>

          <div className="field">
            <label className="field-label" htmlFor="widget_title">
              {t('labels.widgetTitle')}
            </label>
            <input
              id="widget_title"
              className="input"
              type="text"
              value={formData?.widget_title || ''}
              onChange={(e) => updateField('widget_title', e.target.value)}
            />
          </div>

          <div className="field">
            <label className="field-label" htmlFor="widget_color">
              {t('labels.themeColor')}
            </label>
            <input
              id="widget_color"
              className="input"
              type="color"
              value={formData?.widget_color || DEFAULT_WIDGET_COLOR}
              onChange={(e) => updateField('widget_color', e.target.value)}
              style={{
                width: '60px',
                minHeight: '40px',
                padding: 'var(--space-1)',
                cursor: 'pointer',
              }}
            />
          </div>

          <div className="field">
            <label className="field-label" htmlFor="welcome_message">
              {t('labels.welcomeMessage')}
            </label>
            <textarea
              id="welcome_message"
              className="input textarea"
              value={formData?.welcome_message || ''}
              onChange={(e) => updateField('welcome_message', e.target.value)}
              rows={3}
            />
          </div>

          <div className="field">
            <label className="field-label" htmlFor="history_days">
              {t('labels.historyRetention')}
            </label>
            <input
              id="history_days"
              className="input"
              type="number"
              value={formData?.history_days || DEFAULT_HISTORY_DAYS}
              onChange={(e) => updateField('history_days', parseInt(e.target.value, 10) || DEFAULT_HISTORY_DAYS)}
              min={1}
              max={365}
              style={{ width: '120px' }}
            />
          </div>

          <div className="field" style={{ marginBottom: 0 }}>
            <label className="field-label" htmlFor="allowed_widget_origins">
              {t('labels.embedWhitelist')}
            </label>
            <textarea
              id="allowed_widget_origins"
              className="input textarea"
              value={originsText}
              onChange={(e) => {
                setOriginsText(e.target.value);
                setValidationError(null);
              }}
              rows={3}
              placeholder={t('placeholders.embedWhitelist')}
            />
            <p className="field-hint">{t('labels.embedWhitelistFormatHint')}</p>
          </div>
        </section>

        {/* AI conversation limit */}
        <section className="card">
          <div className="card-header">
            <h2 className="card-title">{t('labels.aiConversationLimit')}</h2>
          </div>
          <p className="page-subtitle" style={{ marginTop: 0, marginBottom: 'var(--space-4)' }}>
            {t('labels.aiConversationLimitDesc')}
          </p>

          <div
            style={{
              display: 'flex',
              flexDirection: isMobile ? 'column' : 'row',
              gap: 'var(--space-4)',
              alignItems: isMobile ? 'stretch' : 'flex-start',
              marginBottom: 'var(--space-4)',
            }}
          >
            <div className="field" style={{ marginBottom: 0 }}>
              <label className="field-label" htmlFor="rate_limit_per_minute">
                {t('labels.perMinuteLimit')}
              </label>
              <input
                id="rate_limit_per_minute"
                className="input"
                type="number"
                value={formData?.rate_limit_per_minute ?? 20}
                onChange={(e) => {
                  const value = e.target.value === '' ? 0 : parseInt(e.target.value, 10);
                  updateField('rate_limit_per_minute', isNaN(value) ? 0 : value);
                }}
                min={0}
                style={{ width: '120px' }}
              />
              <p className="field-hint">{t('labels.zeroMeansNoLimit')}</p>
            </div>
          </div>

          <div className="field" style={{ marginBottom: 0 }}>
            <label className="field-label" htmlFor="restricted_reply">
              {t('labels.restrictedReplyLabel')}
            </label>
            <textarea
              id="restricted_reply"
              className="input textarea"
              value={formData?.restricted_reply || ''}
              onChange={(e) => updateField('restricted_reply', e.target.value)}
              rows={2}
              placeholder={t('labels.restrictedReplyPlaceholder')}
            />
            <p className="field-hint">{t('labels.restrictedReplyDesc')}</p>
          </div>
        </section>

        {/* Fixed facts — injected ahead of every KB passage (#39) */}
        <section className="card" data-testid="agent-fixed-facts-card">
          <div className="card-header">
            <h2 className="card-title">{t('fixedFacts.title')}</h2>
            <div className="page-actions">
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleSaveFixedFacts}
                disabled={fixedFactsSaving}
                aria-busy={fixedFactsSaving}
              >
                {fixedFactsSaving ? (
                  <div className="spinner" style={{ width: '14px', height: '14px' }} />
                ) : null}
                {t('fixedFacts.save')}
              </button>
            </div>
          </div>

          <p className="page-subtitle" style={{ marginTop: 0, marginBottom: 'var(--space-4)' }}>
            {t('fixedFacts.description')}
          </p>

          <div className="field" style={{ marginBottom: 0 }}>
            <label className="field-label" htmlFor="fixed_facts">
              {t('fixedFacts.label')}
            </label>
            <textarea
              id="fixed_facts"
              className="input textarea"
              value={fixedFacts}
              onChange={(e) => {
                setFixedFacts(e.target.value);
                setFixedFactsSaved(false);
                setFixedFactsError(null);
              }}
              rows={6}
              placeholder={t('fixedFacts.placeholder')}
            />
            <p className="field-hint">{t('fixedFacts.hint')}</p>
            <p className="field-hint">{t('fixedFacts.linkHint')}</p>
            {fixedFactsError && (
              <p role="alert" className="field-error">
                {fixedFactsError}
              </p>
            )}
            {fixedFactsSaved && (
              <p role="status" aria-live="polite" className="field-hint">
                {t('labels.settingsSaved')}
              </p>
            )}
          </div>
        </section>

        {/* Procedures — one step per turn (#39) */}
        {agent && <ProcedureEditor agentId={agent.id} />}

        {/* #43 conversation policy: escalation prompt + business hours */}
        <section className="card" data-testid="agent-escalation-card">
          <div className="card-header">
            <h2 className="card-title">{t('escalation.title')}</h2>
          </div>

          <p className="page-subtitle" style={{ marginTop: 0, marginBottom: 'var(--space-4)' }}>
            {t('escalation.description')}
          </p>

          <div className="field" style={{ marginBottom: 0 }}>
            <label className="field-label" htmlFor="escalation_rules">
              {t('escalation.label')}
            </label>
            <textarea
              id="escalation_rules"
              className="input textarea"
              value={escalationRules}
              onChange={(e) => setEscalationRules(e.target.value)}
              rows={5}
              maxLength={2000}
              placeholder={t('escalation.placeholder')}
            />
            <p className="field-hint">{t('escalation.hint')}</p>
            <p className="field-hint">
              {escalationRules.length} / 2000
            </p>
          </div>
        </section>

        <section className="card" data-testid="agent-business-hours-card">
          <div className="card-header">
            <h2 className="card-title">{t('businessHours.title')}</h2>
          </div>

          <p className="page-subtitle" style={{ marginTop: 0, marginBottom: 'var(--space-4)' }}>
            {t('businessHours.description')}
          </p>

          <div className="field">
            <label className="field-label" htmlFor="business_hours_timezone">
              {t('businessHours.timezone')}
            </label>
            <select
              id="business_hours_timezone"
              className="input"
              value={businessHours?.timezone ?? ''}
              onChange={(e) => handleTimezoneChange(e.target.value)}
            >
              <option value="">{t('businessHours.timezonePlaceholder')}</option>
              {timezoneOptions.map((zone) => (
                <option key={zone} value={zone}>
                  {zone}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <span className="field-label">{t('businessHours.schedule')}</span>
            {!businessHours || businessHours.schedule.length === 0 ? (
              <p className="field-hint" data-testid="business-hours-empty">
                {t('businessHours.empty')}
              </p>
            ) : (
              <ul
                className="list"
                data-testid="business-hours-ranges"
                style={{ marginTop: 'var(--space-2)' }}
              >
                {businessHours.schedule.map((range, index) => (
                  <li
                    key={`${range.day}-${index}`}
                    className="list-row"
                    style={{
                      display: 'flex',
                      flexWrap: isMobile ? 'wrap' : 'nowrap',
                      alignItems: 'center',
                      gap: 'var(--space-2)',
                    }}
                  >
                    <select
                      className="input"
                      aria-label={`${t('businessHours.day')} ${index + 1}`}
                      value={range.day}
                      onChange={(e) =>
                        handleUpdateRange(index, {
                          day: Number.parseInt(e.target.value, 10),
                        })
                      }
                      style={{ width: isMobile ? '100%' : '130px' }}
                    >
                      {weekdayLabels.map((label, day) => (
                        <option key={label} value={day}>
                          {label}
                        </option>
                      ))}
                    </select>

                    <input
                      className="input"
                      type="time"
                      aria-label={`${t('businessHours.start')} ${index + 1}`}
                      value={minutesToTimeInput(range.start)}
                      onChange={(e) =>
                        handleUpdateRange(index, {
                          start: timeInputToMinutes(e.target.value),
                        })
                      }
                      style={{ width: '120px' }}
                    />

                    <input
                      className="input"
                      type="time"
                      aria-label={`${t('businessHours.end')} ${index + 1}`}
                      value={minutesToTimeInput(range.end)}
                      onChange={(e) =>
                        handleUpdateRange(index, {
                          end: timeInputToMinutes(e.target.value),
                        })
                      }
                      style={{ width: '120px' }}
                    />

                    <button
                      type="button"
                      className="btn btn-icon"
                      aria-label={t('businessHours.removeRange')}
                      title={t('businessHours.removeRange')}
                      style={{ minWidth: 44, minHeight: 44 }}
                      onClick={() => handleRemoveRange(index)}
                    >
                      <Icon name="close" size={16} />
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <div className="page-actions" style={{ marginTop: 'var(--space-3)' }}>
              <button
                type="button"
                className="btn btn-secondary"
                data-testid="business-hours-add"
                onClick={handleAddRange}
                disabled={!businessHours}
              >
                {t('businessHours.addRange')}
              </button>
            </div>
            <p className="field-hint">{t('businessHours.overnightHint')}</p>
          </div>

          <div className="field" style={{ marginBottom: 0 }}>
            <label className="field-label" htmlFor="away_message">
              {t('businessHours.awayMessage')}
            </label>
            <textarea
              id="away_message"
              className="input textarea"
              value={awayMessage}
              onChange={(e) => setAwayMessage(e.target.value)}
              rows={2}
              placeholder={t('businessHours.awayMessagePlaceholder')}
            />
            <p className="field-hint">{t('businessHours.awayMessageHint')}</p>
          </div>
        </section>

        {/* #40 install surface: display mode, excluded paths, rollout */}
        <section className="card" data-testid="agent-install-card">
          <div className="card-header">
            <h2 className="card-title">{t('install.title')}</h2>
          </div>

          <div className="field">
            <label className="field-label" htmlFor="display_mode">
              {t('install.displayMode')}
            </label>
            <select
              id="display_mode"
              className="input"
              data-testid="install-display-mode"
              value={displayMode}
              onChange={(e) => setDisplayMode(e.target.value as DisplayMode)}
            >
              <option value="bubble">{t('install.displayModeBubble')}</option>
              <option value="inline">{t('install.displayModeInline')}</option>
              <option value="iframe">{t('install.displayModeIframe')}</option>
            </select>
            <p className="field-hint">{t('install.displayModeHint')}</p>
          </div>

          {displayMode !== 'bubble' && (
            <div className="field">
              <label className="field-label" htmlFor="inline_container">
                {t('install.inlineContainer')}
              </label>
              <input
                id="inline_container"
                className="input"
                type="text"
                value={inlineContainer}
                onChange={(e) => setInlineContainer(e.target.value)}
                placeholder={t('install.inlineContainerPlaceholder')}
              />
              <p className="field-hint">{t('install.inlineContainerHint')}</p>
            </div>
          )}

          <div className="field">
            <label className="field-label" htmlFor="excluded_paths">
              {t('install.excludedPaths')}
            </label>
            <textarea
              id="excluded_paths"
              className="input textarea"
              data-testid="install-excluded-paths"
              value={excludedPathsText}
              onChange={(e) => setExcludedPathsText(e.target.value)}
              rows={3}
              placeholder={t('install.excludedPathsPlaceholder')}
            />
            <p className="field-hint">{t('install.excludedPathsHint')}</p>
          </div>

          <div className="field" style={{ marginBottom: 0 }}>
            <label className="field-label" htmlFor="traffic_percentage">
              {t('install.trafficPercentage')}
            </label>
            <input
              id="traffic_percentage"
              className="input"
              type="number"
              data-testid="install-traffic"
              value={trafficPercentage}
              onChange={(e) => {
                const parsed = Number.parseInt(e.target.value, 10);
                const next = Number.isNaN(parsed) ? 0 : Math.max(0, Math.min(100, parsed));
                setTrafficPercentage(next);
              }}
              min={0}
              max={100}
              style={{ width: '120px' }}
            />
            <p className="field-hint">{t('install.trafficPercentageHint')}</p>
          </div>
        </section>

        {/* #40: entry cards */}
        <section className="card" data-testid="agent-cards-card">
          <div className="card-header">
            <h2 className="card-title">{t('install.cards')}</h2>
          </div>

          <p className="page-subtitle" style={{ marginTop: 0, marginBottom: 'var(--space-4)' }}>
            {t('install.cardsHint')}
          </p>

          {cardRows.length === 0 ? (
            <p className="field-hint" data-testid="install-cards-empty">
              {t('install.cardsEmpty')}
            </p>
          ) : (
            <ul className="list" data-testid="install-cards">
              {cardRows.map((row, index) => (
                <li
                  key={`card-${index}`}
                  className="list-row"
                  style={{
                    display: 'grid',
                    gap: 'var(--space-2)',
                    gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr auto',
                    alignItems: 'start',
                  }}
                >
                  <div className="field" style={{ marginBottom: 0 }}>
                    <label
                      className="field-label"
                      htmlFor={`card_heading_${index}`}
                    >
                      {t('install.cardHeading')}
                    </label>
                    <input
                      id={`card_heading_${index}`}
                      className="input"
                      type="text"
                      aria-label={`${t('install.cardHeading')} ${index + 1}`}
                      value={row.heading}
                      onChange={(e) => updateCardRow(index, { heading: e.target.value })}
                    />
                  </div>

                  <div className="field" style={{ marginBottom: 0 }}>
                    <label className="field-label" htmlFor={`card_text_${index}`}>
                      {t('install.cardText')}
                    </label>
                    <input
                      id={`card_text_${index}`}
                      className="input"
                      type="text"
                      aria-label={`${t('install.cardText')} ${index + 1}`}
                      value={row.text}
                      onChange={(e) => updateCardRow(index, { text: e.target.value })}
                    />
                  </div>

                  <button
                    type="button"
                    className="btn btn-icon"
                    aria-label={t('install.cardsRemove')}
                    title={t('install.cardsRemove')}
                    style={{ minWidth: 44, minHeight: 44 }}
                    onClick={() => handleRemoveCard(index)}
                  >
                    <Icon name="close" size={16} />
                  </button>

                  <div className="field" style={{ marginBottom: 0 }}>
                    <label className="field-label" htmlFor={`card_logo_${index}`}>
                      {t('install.cardLogo')}
                    </label>
                    <input
                      id={`card_logo_${index}`}
                      className="input"
                      type="text"
                      aria-label={`${t('install.cardLogo')} ${index + 1}`}
                      value={row.logo}
                      onChange={(e) => updateCardRow(index, { logo: e.target.value })}
                    />
                  </div>

                  <div className="field" style={{ marginBottom: 0 }}>
                    <label className="field-label" htmlFor={`card_action_${index}`}>
                      {t('install.cardAction')}
                    </label>
                    <input
                      id={`card_action_${index}`}
                      className="input"
                      type="text"
                      aria-label={`${t('install.cardAction')} ${index + 1}`}
                      value={row.action}
                      onChange={(e) => updateCardRow(index, { action: e.target.value })}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}

          <div className="page-actions" style={{ marginTop: 'var(--space-3)' }}>
            <button
              type="button"
              className="btn btn-secondary"
              data-testid="install-cards-add"
              onClick={handleAddCard}
            >
              {t('install.cardsAdd')}
            </button>
          </div>
        </section>

        {/* #40: starters */}
        <section className="card" data-testid="agent-starters-card">
          <div className="card-header">
            <h2 className="card-title">{t('install.starters')}</h2>
          </div>

          <p className="page-subtitle" style={{ marginTop: 0, marginBottom: 'var(--space-4)' }}>
            {t('install.startersHint')}
          </p>

          {starterRows.length === 0 ? (
            <p className="field-hint" data-testid="install-starters-empty">
              {t('install.startersEmpty')}
            </p>
          ) : (
            <ul className="list" data-testid="install-starters">
              {starterRows.map((row, index) => (
                <li
                  key={`starter-${index}`}
                  className="list-row"
                  style={{
                    display: 'grid',
                    gap: 'var(--space-2)',
                    gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr auto',
                    alignItems: 'start',
                  }}
                >
                  <div className="field" style={{ marginBottom: 0 }}>
                    <label
                      className="field-label"
                      htmlFor={`starter_label_${index}`}
                    >
                      {t('install.starterLabel')}
                    </label>
                    <input
                      id={`starter_label_${index}`}
                      className="input"
                      type="text"
                      aria-label={`${t('install.starterLabel')} ${index + 1}`}
                      value={row.label}
                      onChange={(e) => updateStarterRow(index, { label: e.target.value })}
                    />
                  </div>

                  <div className="field" style={{ marginBottom: 0 }}>
                    <label
                      className="field-label"
                      htmlFor={`starter_action_${index}`}
                    >
                      {t('install.starterAction')}
                    </label>
                    <select
                      id={`starter_action_${index}`}
                      className="input"
                      aria-label={`${t('install.starterAction')} ${index + 1}`}
                      value={row.action}
                      onChange={(e) =>
                        updateStarterRow(index, {
                          action: e.target.value === 'link' ? 'link' : 'message',
                        })
                      }
                    >
                      <option value="message">{t('install.starterActionMessage')}</option>
                      <option value="link">{t('install.starterActionLink')}</option>
                    </select>
                  </div>

                  <button
                    type="button"
                    className="btn btn-icon"
                    aria-label={t('install.startersRemove')}
                    title={t('install.startersRemove')}
                    style={{ minWidth: 44, minHeight: 44 }}
                    onClick={() => handleRemoveStarter(index)}
                  >
                    <Icon name="close" size={16} />
                  </button>

                  <div className="field" style={{ marginBottom: 0 }}>
                    <label
                      className="field-label"
                      htmlFor={`starter_value_${index}`}
                    >
                      {t('install.starterValue')}
                    </label>
                    <input
                      id={`starter_value_${index}`}
                      className="input"
                      type="text"
                      aria-label={`${t('install.starterValue')} ${index + 1}`}
                      value={row.value}
                      onChange={(e) => updateStarterRow(index, { value: e.target.value })}
                    />
                  </div>

                  <div className="field" style={{ marginBottom: 0 }}>
                    <label
                      className="field-label"
                      htmlFor={`starter_path_${index}`}
                    >
                      {t('install.starterPath')}
                    </label>
                    <input
                      id={`starter_path_${index}`}
                      className="input"
                      type="text"
                      aria-label={`${t('install.starterPath')} ${index + 1}`}
                      placeholder={t('install.starterPathPlaceholder')}
                      value={row.path}
                      onChange={(e) => updateStarterRow(index, { path: e.target.value })}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}

          <div className="page-actions" style={{ marginTop: 'var(--space-3)' }}>
            <button
              type="button"
              className="btn btn-secondary"
              data-testid="install-starters-add"
              onClick={handleAddStarter}
            >
              {t('install.startersAdd')}
            </button>
          </div>
        </section>

        {/* #40: the server-rendered snippet + copy button */}
        <section className="card" data-testid="agent-embed-card">
          <div className="card-header">
            <h2 className="card-title">{t('labels.widgetEmbedCode')}</h2>
            <div className="page-actions">
              <button
                type="button"
                className="btn btn-secondary"
                data-testid="install-copy"
                onClick={handleCopyEmbedCode}
                disabled={!embedCode}
                aria-label={t('install.copy')}
                title={t('install.copy')}
              >
                {embedCopied ? t('install.copied') : t('install.copy')}
              </button>
            </div>
          </div>

          <p className="page-subtitle" style={{ marginTop: 0, marginBottom: 'var(--space-4)' }}>
            {t('install.description')}
          </p>

          {publicOriginLoading ? (
            <p className="field-hint" role="status">
              {t('install.serverOriginPending')}
            </p>
          ) : null}
          {!publicOriginLoading && !publicOrigin ? (
            <p className="field-hint" role="alert">
              {t('install.serverOriginUnknown')}
            </p>
          ) : null}

          <pre
            data-testid="install-embed-code"
            style={{
              margin: 0,
              padding: 'var(--space-3)',
              background: 'var(--color-bg-tertiary)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-md)',
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--text-sm)',
              color: 'var(--color-text-secondary)',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
              overflowX: 'auto',
            }}
          >
            {embedCode}
          </pre>

          {/* #40: a loopback origin is only shareable once PUBLIC_BASE_URL is set.
              A warning, never a block — the copy already happened above. */}
          {!publicOriginLoading && isLoopbackOrigin(publicOrigin) ? (
            <p
              data-testid="install-loopback-warning"
              role="status"
              className="field-hint"
              style={{ marginBottom: 0 }}
            >
              {t('install.loopbackOriginHint')}
            </p>
          ) : null}

          {embedCopyError && (
            <p role="alert" className="field-error">
              {embedCopyError}
            </p>
          )}
          {embedCopied && (
            <p role="status" aria-live="polite" className="field-hint">
              {t('install.copied')}
            </p>
          )}
        </section>
      </div>
    </AdminLayout>
  );
}
