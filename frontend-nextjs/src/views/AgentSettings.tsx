'use client';

import { useEffect, useMemo, useState } from 'react';
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

interface AgentSettingsFormData {
  widget_title: string;
  widget_color: string;
  welcome_message: string;
  history_days: number;
  allowed_widget_origins: string[];
  rate_limit_per_minute: number;
  restricted_reply: string;
}

const DEFAULT_WIDGET_COLOR = '#00aaff';
const DEFAULT_HISTORY_DAYS = 30;

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
