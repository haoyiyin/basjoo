'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import AdminLayout from '../components/AdminLayout';
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
        <div style={{ padding: isMobile ? 'var(--space-4)' : 'var(--space-8)', textAlign: 'center' }}>
          {t('status.loading')}
        </div>
      </AdminLayout>
    );
  }

  if (error && !agent) {
    return (
      <AdminLayout>
        <div style={{ padding: isMobile ? 'var(--space-4)' : 'var(--space-8)', textAlign: 'center', color: 'var(--color-error)' }}>
          {error}
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
      <div style={{ padding: isMobile ? 'var(--space-4)' : 'var(--space-8)', maxWidth: '800px', margin: '0 auto' }}>
        <h1 style={{
          fontSize: isMobile ? 'var(--text-2xl)' : 'var(--text-3xl)',
          fontWeight: 700,
          marginBottom: 'var(--space-6)',
          color: 'var(--color-text-primary)',
        }}>
          {t('navigation.agentSettings')}
        </h1>

        <p style={{
          fontSize: 'var(--text-base)',
          color: 'var(--color-text-secondary)',
          marginBottom: 'var(--space-6)',
        }}>
          {t('labels.configAgentSettings')}
        </p>

        {validationError && (
          <div style={{
            padding: 'var(--space-3)',
            marginBottom: 'var(--space-4)',
            background: 'hsla(350deg, 85%, 58%, 0.1)',
            border: '1px solid hsla(350deg, 85%, 58%, 0.3)',
            borderRadius: 'var(--radius-md)',
            color: 'var(--color-error)',
            fontSize: 'var(--text-sm)',
          }}>
            {validationError}
          </div>
        )}

        {saved && (
          <div style={{
            padding: 'var(--space-3)',
            marginBottom: 'var(--space-4)',
            background: 'hsla(150deg, 80%, 45%, 0.1)',
            border: '1px solid hsla(150deg, 80%, 45%, 0.3)',
            borderRadius: 'var(--radius-md)',
            color: 'var(--color-success)',
            fontSize: 'var(--text-sm)',
          }}>
            {t('labels.settingsSaved')}
          </div>
        )}

        <div className="liquid-glass-card" style={{ padding: isMobile ? 'var(--space-4)' : 'var(--space-6)', marginBottom: 'var(--space-6)' }}>
          <div style={{ display: 'grid', gap: 'var(--space-5)' }}>
            {/* Widget Title */}
            <div>
              <label htmlFor="widget_title" style={{
                display: 'block',
                fontSize: 'var(--text-sm)',
                fontWeight: 500,
                marginBottom: 'var(--space-2)',
                color: 'var(--color-text-primary)',
              }}>
                {t('labels.widgetTitle')}
              </label>
              <input
                id="widget_title"
                type="text"
                value={formData?.widget_title || ''}
                onChange={(e) => updateField('widget_title', e.target.value)}
                style={{
                  width: '100%',
                  padding: 'var(--space-3)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-md)',
                  fontSize: 'var(--text-base)',
                  background: 'var(--color-bg-secondary)',
                  color: 'var(--color-text-primary)',
                }}
              />
            </div>

            {/* Theme Color */}
            <div>
              <label htmlFor="widget_color" style={{
                display: 'block',
                fontSize: 'var(--text-sm)',
                fontWeight: 500,
                marginBottom: 'var(--space-2)',
                color: 'var(--color-text-primary)',
              }}>
                {t('labels.themeColor')}
              </label>
              <input
                id="widget_color"
                type="color"
                value={formData?.widget_color || DEFAULT_WIDGET_COLOR}
                onChange={(e) => updateField('widget_color', e.target.value)}
                style={{
                  width: '60px',
                  height: '40px',
                  padding: 'var(--space-1)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-md)',
                  cursor: 'pointer',
                }}
              />
            </div>

            {/* Welcome Message */}
            <div>
              <label htmlFor="welcome_message" style={{
                display: 'block',
                fontSize: 'var(--text-sm)',
                fontWeight: 500,
                marginBottom: 'var(--space-2)',
                color: 'var(--color-text-primary)',
              }}>
                {t('labels.welcomeMessage')}
              </label>
              <textarea
                id="welcome_message"
                value={formData?.welcome_message || ''}
                onChange={(e) => updateField('welcome_message', e.target.value)}
                rows={3}
                style={{
                  width: '100%',
                  padding: 'var(--space-3)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-md)',
                  fontSize: 'var(--text-base)',
                  background: 'var(--color-bg-secondary)',
                  color: 'var(--color-text-primary)',
                  resize: 'vertical',
                }}
              />
            </div>

            {/* History Retention */}
            <div>
              <label htmlFor="history_days" style={{
                display: 'block',
                fontSize: 'var(--text-sm)',
                fontWeight: 500,
                marginBottom: 'var(--space-2)',
                color: 'var(--color-text-primary)',
              }}>
                {t('labels.historyRetention')}
              </label>
              <input
                id="history_days"
                type="number"
                value={formData?.history_days || DEFAULT_HISTORY_DAYS}
                onChange={(e) => updateField('history_days', parseInt(e.target.value, 10) || DEFAULT_HISTORY_DAYS)}
                min={1}
                max={365}
                style={{
                  width: '120px',
                  padding: 'var(--space-3)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-md)',
                  fontSize: 'var(--text-base)',
                  background: 'var(--color-bg-secondary)',
                  color: 'var(--color-text-primary)',
                }}
              />
            </div>

            {/* Embed Whitelist */}
            <div>
              <label htmlFor="allowed_widget_origins" style={{
                display: 'block',
                fontSize: 'var(--text-sm)',
                fontWeight: 500,
                marginBottom: 'var(--space-2)',
                color: 'var(--color-text-primary)',
              }}>
                {t('labels.embedWhitelist')}
              </label>
              <textarea
                id="allowed_widget_origins"
                value={originsText}
                onChange={(e) => {
                  setOriginsText(e.target.value);
                  setValidationError(null);
                }}
                rows={3}
                placeholder={t('placeholders.embedWhitelist')}
                style={{
                  width: '100%',
                  padding: 'var(--space-3)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-md)',
                  fontSize: 'var(--text-base)',
                  background: 'var(--color-bg-secondary)',
                  color: 'var(--color-text-primary)',
                  resize: 'vertical',
                }}
              />
              <p style={{
                fontSize: 'var(--text-xs)',
                color: 'var(--color-text-muted)',
                marginTop: 'var(--space-2)',
              }}>
                {t('labels.embedWhitelistFormatHint')}
              </p>
            </div>

            {/* Embed Code */}
            <div>
              <label style={{
                display: 'block',
                fontSize: 'var(--text-sm)',
                fontWeight: 500,
                marginBottom: 'var(--space-2)',
                color: 'var(--color-text-primary)',
              }}>
                {t('labels.widgetEmbedCode')}
              </label>
              <div style={{
                padding: 'var(--space-3)',
                background: 'var(--color-bg-tertiary)',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-md)',
                fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Consolas, monospace',
                fontSize: 'var(--text-sm)',
                color: 'var(--color-text-secondary)',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all',
              }}>
                {embedCode}
              </div>
            </div>
          </div>

          {/* Save Button */}
          <div style={{ marginTop: 'var(--space-6)' }}>
            <button
              onClick={handleSave}
              disabled={saving}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 'var(--space-2)',
                padding: 'var(--space-3) var(--space-6)',
                background: saving ? 'var(--color-bg-tertiary)' : 'var(--color-accent-primary)',
                color: 'var(--color-text-inverse)',
                border: 'none',
                borderRadius: 'var(--radius-md)',
                fontSize: 'var(--text-base)',
                fontWeight: 500,
                cursor: saving ? 'not-allowed' : 'pointer',
                transition: 'all var(--transition-fast)',
              }}
            >
              {saving ? t('status.saving') : t('buttons.save')}
            </button>
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}