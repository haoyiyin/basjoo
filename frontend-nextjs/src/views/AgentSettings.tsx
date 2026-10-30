'use client';

import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import AdminLayout from '../components/AdminLayout';
import { Icon } from '../components/Icon';
import { api, type Agent } from '../services/api';
import { API_BASE_URL } from '../lib/env';
import {
  validateAllowedWidgetOriginsText,
} from '../lib/widgetOrigins';
import {
  buildWidgetEmbedCode,
  resolveWidgetScriptBaseUrl,
} from '../lib/widgetEmbedCode';
import { useIsMobile } from '../hooks/useMediaQuery';
import { THEMES as WIDGET_THEMES } from '../design/widgetTheme';

interface AgentSettingsFormData {
  widget_title: string;
  widget_color: string;
  welcome_message: string;
  history_days: number;
  allowed_widget_origins: string[];
  rate_limit_per_minute: number;
  restricted_reply: string;
}

// The console accent (hsl(48 96% 49%), the logo's yellow). This is the only
// place the SPA may hold the value — it cannot import Python — and it must stay
// equal to backend/constants.py: DEFAULT_WIDGET_COLOR and to the widget's
// widget/src/theme.ts: ACCENT (spec contract C1, issue #48).
const DEFAULT_WIDGET_COLOR = '#F9CA02';
const DEFAULT_HISTORY_DAYS = 30;

/* ---------------------------------------------------------------------------
 * Live widget preview (issue #48, acceptance item "the settings page renders a
 * live preview of the actual widget").
 *
 * The preview is not a second palette: every colour, radius, shadow, spacing
 * and type value below is read out of `WIDGET_THEMES` — the widget's own token
 * mirror (`widget/src/theme.ts`), which `widget/src/theme.test.ts` pins to
 * `frontend-nextjs/src/index.css`. Element order, radii and metrics copy
 * `widget/src/BasjooWidget.tsx` `createStyles()` one-for-one, so "what I picked"
 * and "what ships" cannot diverge. Only the operator's own `widget_color`
 * arrives as a value (it is the same `formData.widget_color` the embed reads).
 * ------------------------------------------------------------------------- */

/** The widget window is 380px wide; the preview is 360px so it still fits a
 * 375px viewport (24px card gutters) without horizontal overflow. */
const WIDGET_PREVIEW_WIDTH = 360;

type WidgetPreviewTheme = 'light' | 'dark';

function readPreviewTheme(): WidgetPreviewTheme {
	if (typeof document === 'undefined') return 'light';
	return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

/**
 * The widget's own accent-ramp helpers, mirrored for the preview: the shipped
 * widget darkens `themeColor` by 20 for the header gradient and lays a 15%
 * tint of the on-accent ink behind its controls. Same maths, same output.
 */
function previewParseColor(value: string): { r: number; g: number; b: number } | null {
	const raw = (value || '').trim();

	const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(raw);
	if (hex) {
		const digits = hex[1];
		const bytes =
			digits.length === 3
				? digits.split('').map((digit) => parseInt(digit + digit, 16))
				: [0, 2, 4].map((index) => parseInt(digits.slice(index, index + 2), 16));
		return { r: bytes[0], g: bytes[1], b: bytes[2] };
	}

	const hsl = /^hsla?\(\s*([\d.]+)(?:deg)?[\s,]+([\d.]+)%[\s,]+([\d.]+)%/i.exec(raw);
	if (hsl) {
		const hue = ((Number.parseFloat(hsl[1]) % 360) + 360) % 360;
		const saturation = Number.parseFloat(hsl[2]) / 100;
		const lightness = Number.parseFloat(hsl[3]) / 100;
		const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
		const second = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
		const offset = lightness - chroma / 2;
		let rgb: [number, number, number];
		if (hue < 60) rgb = [chroma, second, 0];
		else if (hue < 120) rgb = [second, chroma, 0];
		else if (hue < 180) rgb = [0, chroma, second];
		else if (hue < 240) rgb = [0, second, chroma];
		else if (hue < 300) rgb = [second, 0, chroma];
		else rgb = [chroma, 0, second];
		return {
			r: Math.round((rgb[0] + offset) * 255),
			g: Math.round((rgb[1] + offset) * 255),
			b: Math.round((rgb[2] + offset) * 255),
		};
	}

	return null;
}

/** `adjustColor(color, -20)` — the header's darker gradient stop. */
function previewAdjustColor(color: string, amount: number): string {
	const parsed = previewParseColor(color);
	if (!parsed) return color;
	const clamp = (channel: number) => Math.max(0, Math.min(255, channel + amount));
	return `rgb(${clamp(parsed.r)}, ${clamp(parsed.g)}, ${clamp(parsed.b)})`;
}

/** `hexToRgba(color, alpha)` — used for the control tints. */
function previewTint(color: string, alpha: number): string {
	// An unparsable value falls back to the shipped default, never to a literal.
	const parsed = previewParseColor(color) ?? previewParseColor(DEFAULT_WIDGET_COLOR);
	if (!parsed) return color;
	return `rgba(${parsed.r}, ${parsed.g}, ${parsed.b}, ${alpha})`;
}

interface WidgetPreviewProps {
	title: string;
	color: string;
	welcomeMessage: string;
	userMessage: string;
	placeholder: string;
}

/**
 * The shipped widget's chat window, rendered with its own markup order and its
 * own token values. Decorative: the surrounding block carries the heading, the
 * preview itself is `aria-hidden` so a screen reader is never read a sample
 * conversation it cannot act on.
 */
function WidgetPreview({
	title,
	color,
	welcomeMessage,
	userMessage,
	placeholder,
}: WidgetPreviewProps) {
	const [theme, setTheme] = useState<WidgetPreviewTheme>(readPreviewTheme);

	useEffect(() => {
		setTheme(readPreviewTheme());
	}, []);

	const tokens = WIDGET_THEMES[theme];
	const accent = color || DEFAULT_WIDGET_COLOR;

	const frameStyle: CSSProperties = {
		// The widget ships `* { box-sizing: border-box }`; inline styles do not
		// inherit it, so every box below opts in explicitly.
		boxSizing: 'border-box',
		width: `${WIDGET_PREVIEW_WIDTH}px`,
		maxWidth: '100%',
		overflow: 'hidden',
		display: 'flex',
		flexDirection: 'column',
		background: tokens.surface,
		borderRadius: tokens.radiusLg,
		boxShadow: tokens.shadow3,
		fontFamily: tokens.fontText,
	};

	// `.basjoo-header` — accent gradient, display face, 20/24 padding.
	const headerStyle: CSSProperties = {
		background: `linear-gradient(135deg, ${accent} 0%, ${previewAdjustColor(accent, -20)} 100%)`,
		color: tokens.accentContrast,
		padding: `${tokens.space5} ${tokens.space6}`,
		display: 'flex',
		alignItems: 'center',
		justifyContent: 'space-between',
		flexShrink: 0,
	};

	// `.basjoo-header-title` — 18px/600 in the display face. The widget sets no
	// line-height here, so neither does the preview: adding one shifts the
	// baseline and is the single largest pixel delta between the two panes.
	const headerTitleStyle: CSSProperties = {
		display: 'flex',
		alignItems: 'center',
		gap: tokens.space3,
		fontFamily: tokens.fontDisplay,
		fontSize: '18px',
		fontWeight: 600,
		minWidth: 0,
	};

	// `.basjoo-close` — 32px control, radius-sm, 15% on-accent tint.
	const closeStyle: CSSProperties = {
		boxSizing: 'border-box',
		width: '32px',
		height: '32px',
		border: 'none',
		background: previewTint(tokens.accentContrast, 0.15),
		borderRadius: tokens.radiusSm,
		display: 'flex',
		alignItems: 'center',
		justifyContent: 'center',
		color: tokens.accentContrast,
		flexShrink: 0,
	};

	// `.basjoo-messages` — sunken ground, 20px padding, 16px gap.
	const messagesStyle: CSSProperties = {
		padding: tokens.space5,
		display: 'flex',
		flexDirection: 'column',
		gap: tokens.space4,
		background: tokens.surfaceSunken,
	};

	// `.basjoo-message` — the column that holds ONE bubble plus its timestamp.
	// The widget nests the time inside the message, so the preview must too:
	// a sibling timestamp would change the message height and shift everything
	// below it, which is exactly the kind of drift this preview exists to catch.
	const messageColumn = (align: 'flex-start' | 'flex-end'): CSSProperties => ({
		display: 'flex',
		flexDirection: 'column',
		alignItems: align,
		alignSelf: align,
		maxWidth: '85%',
		minWidth: 0,
		width: 'fit-content',
	});

	// `.basjoo-message-content` — shared box; the role rules below only paint it.
	const bubbleStyle = (background: string, color: string): CSSProperties => ({
		boxSizing: 'border-box',
		display: 'block',
		alignSelf: 'inherit',
		width: 'fit-content',
		maxWidth: '100%',
		minWidth: 0,
		padding: `${tokens.space3} ${tokens.space4}`,
		borderRadius: tokens.radiusLg,
		fontSize: '14px',
		lineHeight: tokens.leadingNormal,
		whiteSpace: 'pre-wrap',
		wordBreak: 'break-word',
		overflowWrap: 'anywhere',
		background,
		color,
	});

	// `.basjoo-message-assistant .basjoo-message-content`
	const assistantBubbleStyle: CSSProperties = {
		...bubbleStyle(tokens.surfaceRaised, tokens.textPrimary),
		borderBottomLeftRadius: tokens.radiusSm,
	};

	// `.basjoo-message-user .basjoo-message-content`
	const userBubbleStyle: CSSProperties = {
		...bubbleStyle(accent, tokens.accentContrast),
		borderBottomRightRadius: tokens.radiusSm,
	};

	const timeStyle: CSSProperties = {
		fontSize: '11px',
		color: tokens.textMuted,
		marginTop: tokens.space1,
		padding: `0 ${tokens.space1}`,
	};

	// `.basjoo-input-area` — surface ground, 1px top border, 16/20/24/20.
	const composerStyle: CSSProperties = {
		boxSizing: 'border-box',
		padding: `${tokens.space4} ${tokens.space5} ${tokens.space6} ${tokens.space5}`,
		borderTop: `1px solid ${tokens.border}`,
		display: 'flex',
		gap: tokens.space3,
		background: tokens.surface,
		flexShrink: 0,
	};

	// `.basjoo-input` — 48px tall, radius-lg, raised ground, 20px inset.
	const inputStyle: CSSProperties = {
		boxSizing: 'border-box',
		flex: 1,
		minWidth: 0,
		height: '48px',
		padding: `0 ${tokens.space5}`,
		border: `1px solid ${tokens.border}`,
		borderRadius: tokens.radiusLg,
		fontSize: '14px',
		fontFamily: tokens.fontText,
		background: tokens.surfaceRaised,
		color: tokens.textMuted,
		display: 'flex',
		alignItems: 'center',
		marginBottom: tokens.space2,
		marginLeft: tokens.space1,
	};

	// `.basjoo-send` — 48px accent disc with the on-accent ink.
	const sendStyle: CSSProperties = {
		boxSizing: 'border-box',
		width: '48px',
		height: '48px',
		border: 'none',
		borderRadius: tokens.radiusFull,
		background: accent,
		color: tokens.accentContrast,
		display: 'flex',
		alignItems: 'center',
		justifyContent: 'center',
		flexShrink: 0,
	};

	return (
		<div style={frameStyle} data-testid="widget-preview" aria-hidden="true">
			<div style={headerStyle} data-testid="widget-preview-header">
				<div style={headerTitleStyle}>
					<span
						style={{
							overflow: 'hidden',
							textOverflow: 'ellipsis',
							whiteSpace: 'nowrap',
						}}
					>
						{title}
					</span>
				</div>
				<div style={closeStyle}>
					<Icon name="close" size={16} />
				</div>
			</div>

			<div style={messagesStyle}>
				<div style={messageColumn('flex-start')}>
					<div style={assistantBubbleStyle}>{welcomeMessage}</div>
					<div style={timeStyle}>12:00</div>
				</div>
				<div style={messageColumn('flex-end')}>
					<div style={userBubbleStyle}>{userMessage}</div>
					<div style={{ ...timeStyle, textAlign: 'right' }}>12:00</div>
				</div>
			</div>

			<div style={composerStyle}>
				<div style={inputStyle}>{placeholder}</div>
				<div style={sendStyle}>
					<Icon name="send" size={20} />
				</div>
			</div>
		</div>
	);
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
    } catch (err) {
      setError(t('errors.loadFailed'));
    } finally {
      setLoading(false);
    }
  };

  const embedCode = useMemo(() => {
    if (!agent) return '';
    const scriptBaseUrl = resolveWidgetScriptBaseUrl(API_BASE_URL);
    return buildWidgetEmbedCode(agent.id, scriptBaseUrl);
  }, [agent]);

  const handleSave = async () => {
    if (!agent || !formData) return;

    // Validate origins
    const { normalizedOrigins, invalidOrigins } = validateAllowedWidgetOriginsText(originsText);
    if (invalidOrigins.length > 0) {
      setValidationError(t('labels.embedWhitelistInvalid', { origins: invalidOrigins.join(', ') }));
      return;
    }
    setValidationError(null);

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
      };
      const updatedAgent = await api.updateAgent(agent.id, updates);
      setAgent(updatedAgent);
      setFormData(formDataFromAgent(updatedAgent));
      setOriginsText(normalizedOrigins.join('\n'));
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

          {/*
           * The fields and the live preview sit side by side on desktop and
           * stack at 375px. The preview is 360px wide (the widget window is
           * 380px) so it always fits inside the card without overflow.
           */}
          <div
            style={{
              display: 'flex',
              flexDirection: isMobile ? 'column' : 'row',
              gap: 'var(--space-6)',
              alignItems: 'flex-start',
            }}
          >
            <div style={{ flex: '1 1 280px', minWidth: 0, width: '100%' }}>
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

              <div className="field" style={{ marginBottom: 0 }}>
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
            </div>

            {/* The shipped widget, painted with its own token set. */}
            <div style={{ flex: '0 0 auto', maxWidth: '100%', minWidth: 0 }}>
              <p className="field-label" style={{ marginBottom: 'var(--space-2)' }}>
                {t('settings.widgetPreview.title')}
              </p>
              <WidgetPreview
                title={formData?.widget_title || ''}
                color={formData?.widget_color || DEFAULT_WIDGET_COLOR}
                welcomeMessage={formData?.welcome_message || ''}
                userMessage={t('settings.widgetPreview.sampleUserMessage')}
                placeholder={t('settings.widgetPreview.samplePlaceholder')}
              />
            </div>
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

        {/* Embed code */}
        <section className="card">
          <div className="card-header">
            <h2 className="card-title">{t('labels.widgetEmbedCode')}</h2>
          </div>
          <pre
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
        </section>
      </div>
    </AdminLayout>
  );
}
