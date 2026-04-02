'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import AdminLayout from '../components/AdminLayout'
import HelpTooltip from '../components/HelpTooltip'
import { api } from '../services/api'
import type { Agent } from '../services/api'
import { useIsMobile } from '../hooks/useMediaQuery'
import { useTheme } from '../context/ThemeContext'
import { API_BASE_URL } from '../lib/env'

const languages = [
  { code: 'zh-CN', name: '简体中文', flag: '🇨🇳' },
  { code: 'en-US', name: 'English', flag: '🇺🇸' },
]

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'

export default function SystemSettings() {
  const { t, i18n } = useTranslation('common')
  const navigate = useNavigate()
  const isMobile = useIsMobile()
  const { theme, setTheme } = useTheme()
  const [loading, setLoading] = useState(true)
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [agentIdCopied, setAgentIdCopied] = useState(false)
  const [agent, setAgent] = useState<Agent | null>(null)
  const [serverApiBase, setServerApiBase] = useState<string>('')
  const turnstileSaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [settings, setSettings] = useState({
    agent_id: '',
    widget_title: '',
    widget_color: '#06B6D4',
    welcome_message: '',
    history_days: 30,
    rate_limit_per_hour: 100,
    restricted_reply: '',
    enable_turnstile: false,
    turnstile_site_key: '',
    turnstile_secret_key: '',
    turnstile_secret_key_set: false,
  })

  useEffect(() => {
    fetchSettings()
    fetchServerConfig()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 获取服务器公开配置，用于嵌入代码自动适配部署环境
  const fetchServerConfig = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/v1/config:public`)
      if (response.ok) {
        const data = await response.json()
        if (data.api_base) {
          setServerApiBase(data.api_base)
        }
      }
    } catch (err) {
      console.error('Failed to fetch server config:', err)
    }
  }

  // 自动保存状态清除
  useEffect(() => {
    if (saveStatus === 'saved' || saveStatus === 'error') {
      const timer = setTimeout(() => {
        setSaveStatus('idle')
      }, 2000)
      return () => clearTimeout(timer)
    }
  }, [saveStatus])

  const fetchSettings = async () => {
    try {
      setLoading(true)
      setError(null)

      const agentData = await api.getDefaultAgent()
      setAgent(agentData)
      setSettings({
        agent_id: agentData.id || '',
        widget_title: agentData.widget_title || '',
        widget_color: agentData.widget_color || '#06B6D4',
        welcome_message: agentData.welcome_message || '',
        history_days: agentData.history_days || 30,
        rate_limit_per_hour: agentData.rate_limit_per_hour ?? 100,
        restricted_reply: agentData.restricted_reply || '',
        enable_turnstile: agentData.enable_turnstile ?? false,
        turnstile_site_key: agentData.turnstile_site_key || '',
        turnstile_secret_key: '',
        turnstile_secret_key_set: agentData.turnstile_secret_key_set ?? false,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errors.loadFailed'))
    } finally {
      setLoading(false)
    }
  }

  const handleAutoSave = useCallback(async (newSettings: typeof settings) => {
    if (!agent) return
    setSaveStatus('saving')
    setError(null)
    try {
      const updateData = {
        widget_title: newSettings.widget_title,
        widget_color: newSettings.widget_color,
        welcome_message: newSettings.welcome_message,
        history_days: newSettings.history_days,
        rate_limit_per_hour: newSettings.rate_limit_per_hour,
        restricted_reply: newSettings.restricted_reply,
        enable_turnstile: newSettings.enable_turnstile,
        turnstile_site_key: newSettings.turnstile_site_key || null,
        turnstile_secret_key: newSettings.turnstile_secret_key || null,
      }

      const updatedAgent = await api.updateAgent(agent.id, updateData)
      setAgent(updatedAgent)
      setSettings(prev => ({
        ...prev,
        turnstile_secret_key: '',
        turnstile_secret_key_set: updatedAgent.turnstile_secret_key_set ?? prev.turnstile_secret_key_set,
      }))
      setSaveStatus('saved')
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errors.saveFailed'))
      setSaveStatus('error')
    }
  }, [agent, t])

  const updateSetting = useCallback(<K extends keyof typeof settings>(
    key: K,
    value: typeof settings[K]
  ) => {
    const newSettings = { ...settings, [key]: value }
    setSettings(newSettings)
    return newSettings
  }, [settings])

  const handleChangeWithAutoSave = useCallback(<K extends keyof typeof settings>(
    key: K,
    value: typeof settings[K]
  ) => {
    const newSettings = updateSetting(key, value)
    handleAutoSave(newSettings)
  }, [updateSetting, handleAutoSave])

  const handleTurnstileChange = useCallback(<K extends 'enable_turnstile' | 'turnstile_site_key' | 'turnstile_secret_key'>(
    key: K,
    value: typeof settings[K]
  ) => {
    const newSettings = updateSetting(key, value)
    if (turnstileSaveTimeoutRef.current) {
      clearTimeout(turnstileSaveTimeoutRef.current)
    }
    turnstileSaveTimeoutRef.current = setTimeout(() => {
      handleAutoSave(newSettings)
    }, 500)
  }, [updateSetting, handleAutoSave])

  useEffect(() => {
    return () => {
      if (turnstileSaveTimeoutRef.current) {
        clearTimeout(turnstileSaveTimeoutRef.current)
      }
    }
  }, [])

  const getEmbedApiBase = () => {
    const rawApiBase = serverApiBase || API_BASE_URL || 'http://localhost:8000'

    try {
      const url = new URL(rawApiBase, window.location.origin)
      if ((url.protocol === 'http:' || url.protocol === 'https:') && url.port === '3000') {
        return `${url.protocol}//${url.hostname}:8000`
      }
      return url.toString().replace(/\/$/, '')
    } catch {
      return rawApiBase
    }
  }

  const getEmbedCode = () => {
    const apiBase = getEmbedApiBase()
    const sdkVersion = '2.0.2'
    const turnstileComment = agent?.enable_turnstile
      ? `\n<!-- Bot protection enabled for this agent -->`
      : ''
    const sdkUrl = new URL(`${apiBase}/sdk.js`)
    sdkUrl.searchParams.set('v', sdkVersion)

    const widgetConfig = {
      agentId: settings.agent_id || '',
      apiBase,
      themeColor: settings.widget_color || undefined,
    }

    return `<!-- ${t('appName')} Widget -->
<script src="${sdkUrl.toString()}"></script>
<script>
  new window.BasjooWidget(${JSON.stringify(widgetConfig, null, 2)}).init()
</script>${turnstileComment}`
  }

  const handleCopyEmbedCode = async () => {
    try {
      await navigator.clipboard.writeText(getEmbedCode())
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      const textArea = document.createElement('textarea')
      textArea.value = getEmbedCode()
      document.body.appendChild(textArea)
      textArea.select()
      document.execCommand('copy')
      document.body.removeChild(textArea)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  const handleCopyAgentId = async () => {
    if (!settings.agent_id) return
    try {
      await navigator.clipboard.writeText(settings.agent_id)
    } catch {
      const textArea = document.createElement('textarea')
      textArea.value = settings.agent_id
      document.body.appendChild(textArea)
      textArea.select()
      document.execCommand('copy')
      document.body.removeChild(textArea)
    }
    setAgentIdCopied(true)
    setTimeout(() => setAgentIdCopied(false), 2000)
  }

  const getAgentErrorMessage = useCallback((errorCode?: string | null) => {
    if (!errorCode) return ''
    const key = `errors.agentError${errorCode}`
    const translated = t(key)
    return translated === key ? (agent?.last_error_message || errorCode) : translated
  }, [agent?.last_error_message, t])

  const handleDismissAgentError = useCallback(async () => {
    if (!agent) return
    try {
      await api.clearAgentError(agent.id)
      setAgent(prev => prev ? {
        ...prev,
        last_error_code: null,
        last_error_message: null,
        last_error_at: null,
      } : prev)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errors.saveFailed'))
    }
  }, [agent, t])

  if (loading) {
    return (
      <AdminLayout>
        <div style={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          height: '50vh',
        }}>
          <div className="spinner" />
        </div>
      </AdminLayout>
    )
  }

  return (
    <AdminLayout>
      <div style={{
        padding: isMobile ? 'var(--space-4)' : 'var(--space-8)',
        maxWidth: '800px',
        margin: '0 auto',
      }}>
        <header style={{
          marginBottom: 'var(--space-8)',
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-4)',
        }}>
          <button
            onClick={() => navigate('/')}
            className="btn-ghost"
            style={{
              padding: 'var(--space-2)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
          </button>
          <div style={{ flex: 1 }}>
            <h1 style={{
              fontSize: 'var(--text-3xl)',
              fontWeight: 700,
              color: 'var(--color-text-primary)',
              marginBottom: 'var(--space-1)',
            }}>
              {t('navigation.systemSettings')}
            </h1>
            <p style={{
              color: 'var(--color-text-secondary)',
              fontSize: 'var(--text-sm)',
            }}>
              {t('settings.widgetSettingsDesc')}
            </p>
          </div>
          {/* 保存状态指示器 */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-2)',
            fontSize: 'var(--text-sm)',
            color: saveStatus === 'saved' ? '#10B981' : saveStatus === 'error' ? '#ef4444' : 'var(--color-text-muted)',
          }}>
            {saveStatus === 'saving' && (
              <>
                <div className="spinner" style={{ width: '16px', height: '16px', borderWidth: '2px' }} />
                <span>{t('status.saving')}</span>
              </>
            )}
            {saveStatus === 'saved' && (
              <>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                <span>{t('status.saved')}</span>
              </>
            )}
            {saveStatus === 'error' && (
              <>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="15" y1="9" x2="9" y2="15" />
                  <line x1="9" y1="9" x2="15" y2="15" />
                </svg>
                <span>{t('status.error')}</span>
              </>
            )}
          </div>
        </header>

        {error && (
          <div style={{
            padding: 'var(--space-4)',
            marginBottom: 'var(--space-6)',
            background: 'rgba(239, 68, 68, 0.1)',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            borderRadius: 'var(--radius-md)',
            color: '#ef4444',
          }}>
            {error}
          </div>
        )}

        {agent?.last_error_code && (
          <div style={{
            padding: 'var(--space-4)',
            marginBottom: 'var(--space-6)',
            background: 'rgba(245, 158, 11, 0.12)',
            border: '1px solid rgba(245, 158, 11, 0.35)',
            borderRadius: 'var(--radius-md)',
            color: 'var(--color-text-primary)',
          }}>
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: isMobile ? 'flex-start' : 'center',
              flexDirection: isMobile ? 'column' : 'row',
              gap: 'var(--space-3)',
            }}>
              <div>
                <div style={{ fontWeight: 600, marginBottom: 'var(--space-1)' }}>
                  {t('errors.agentErrorBanner')}
                </div>
                <div style={{ marginBottom: 'var(--space-1)' }}>
                  {getAgentErrorMessage(agent.last_error_code)}
                </div>
                {agent.last_error_at && (
                  <div style={{
                    fontSize: 'var(--text-xs)',
                    color: 'var(--color-text-muted)',
                  }}>
                    {new Date(agent.last_error_at).toLocaleString(i18n.language)}
                  </div>
                )}
              </div>
              <button className="btn-secondary" onClick={handleDismissAgentError}>
                {t('errors.agentErrorDismiss')}
              </button>
            </div>
          </div>
        )}

        <div className="glass-card" style={{
          padding: 'var(--space-6)',
          marginBottom: 'var(--space-6)',
        }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-3)',
            marginBottom: 'var(--space-4)',
          }}>
            <div style={{
              width: '40px',
              height: '40px',
              background: 'linear-gradient(135deg, #6366F1, #8B5CF6)',
              borderRadius: 'var(--radius-md)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
                <circle cx="12" cy="12" r="5" />
                <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
              </svg>
            </div>
            <div>
              <h2 style={{
                fontSize: 'var(--text-lg)',
                fontWeight: 600,
                color: 'var(--color-text-primary)',
              }}>
                {t('settings.appearance')}
              </h2>
              <p style={{
                fontSize: 'var(--text-sm)',
                color: 'var(--color-text-muted)',
              }}>
                {t('settings.appearanceDesc')}
              </p>
            </div>
          </div>

          <div style={{
            display: 'grid',
            gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr',
            gap: 'var(--space-4)',
          }}>
            <div>
              <label style={{
                display: 'block',
                marginBottom: 'var(--space-2)',
                fontSize: 'var(--text-sm)',
                fontWeight: 500,
                color: 'var(--color-text-secondary)',
              }}>
                {t('settings.theme')}
              </label>
              <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                {(['light', 'dark', 'system'] as const).map((themeOption) => (
                  <button
                    key={themeOption}
                    onClick={() => setTheme(themeOption)}
                    style={{
                      flex: 1,
                      padding: 'var(--space-3)',
                      background: theme === themeOption ? 'var(--color-accent-primary)' : 'var(--color-bg-tertiary)',
                      color: theme === themeOption ? 'var(--color-text-inverse)' : 'var(--color-text-secondary)',
                      border: theme === themeOption ? 'none' : '1px solid var(--color-border)',
                      borderRadius: 'var(--radius-md)',
                      cursor: 'pointer',
                      fontSize: 'var(--text-sm)',
                      fontWeight: 500,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 'var(--space-2)',
                      transition: 'all var(--transition-fast)',
                    }}
                  >
                    <span>{themeOption === 'light' ? '☀️' : themeOption === 'dark' ? '🌙' : '💻'}</span>
                    {t(`theme.${themeOption}`)}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label style={{
                display: 'block',
                marginBottom: 'var(--space-2)',
                fontSize: 'var(--text-sm)',
                fontWeight: 500,
                color: 'var(--color-text-secondary)',
              }}>
                {t('settings.language')}
              </label>
              <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                {languages.map((lang) => (
                  <button
                    key={lang.code}
                    onClick={() => i18n.changeLanguage(lang.code)}
                    style={{
                      flex: 1,
                      padding: 'var(--space-3)',
                      background: i18n.language === lang.code ? 'var(--color-accent-primary)' : 'var(--color-bg-tertiary)',
                      color: i18n.language === lang.code ? 'var(--color-text-inverse)' : 'var(--color-text-secondary)',
                      border: i18n.language === lang.code ? 'none' : '1px solid var(--color-border)',
                      borderRadius: 'var(--radius-md)',
                      cursor: 'pointer',
                      fontSize: 'var(--text-sm)',
                      fontWeight: 500,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 'var(--space-2)',
                      transition: 'all var(--transition-fast)',
                    }}
                  >
                    <span>{lang.flag}</span>
                    {lang.name}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="glass-card" style={{
          padding: 'var(--space-6)',
          marginBottom: 'var(--space-6)',
        }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-3)',
            marginBottom: 'var(--space-4)',
          }}>
            <div style={{
              width: '40px',
              height: '40px',
              background: 'linear-gradient(135deg, #8B5CF6, #EC4899)',
              borderRadius: 'var(--radius-md)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <path d="M9 9h6v6H9z" />
              </svg>
            </div>
            <div>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-2)',
              }}>
                <h2 style={{
                  fontSize: 'var(--text-lg)',
                  fontWeight: 600,
                  color: 'var(--color-text-primary)',
                }}>
                  {t('labels.widgetAppearance')}
                </h2>
                <HelpTooltip
                  title={t('settings.widgetSettings')}
                  content={[
                    t('labels.widgetAppearanceDesc'),
                    t('labels.windowTitleDesc'),
                    t('labels.themeColorDesc'),
                    t('labels.themeColorAdvice')
                  ]}
                  position="top"
                  size="sm"
                />
              </div>
              <p style={{
                fontSize: 'var(--text-sm)',
                color: 'var(--color-text-muted)',
              }}>
                {t('labels.customizeTitleColor')}
              </p>
            </div>
          </div>
          
          <div style={{
            display: 'grid',
            gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr',
            gap: 'var(--space-4)',
            marginBottom: 'var(--space-4)',
          }}>
            <div>
              <label style={{
                display: 'block',
                marginBottom: 'var(--space-2)',
                fontSize: 'var(--text-sm)',
                fontWeight: 500,
                color: 'var(--color-text-secondary)',
              }}>
                {t('labels.widgetTitle')}
              </label>
              <input
                type="text"
                value={settings.widget_title}
                onChange={(e) => handleChangeWithAutoSave('widget_title', e.target.value)}
                placeholder={t('labels.welcomeMessage')}
              />
            </div>
            <div>
              <label style={{
                display: 'block',
                marginBottom: 'var(--space-2)',
                fontSize: 'var(--text-sm)',
                fontWeight: 500,
                color: 'var(--color-text-secondary)',
              }}>
                {t('labels.themeColor')}
              </label>
              <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                <input
                  type="color"
                  value={settings.widget_color}
                  onChange={(e) => handleChangeWithAutoSave('widget_color', e.target.value)}
                  style={{
                    width: '48px',
                    height: '40px',
                    padding: '2px',
                    cursor: 'pointer',
                    borderRadius: 'var(--radius-md)',
                  }}
                />
                <input
                  type="text"
                  value={settings.widget_color}
                  onChange={(e) => handleChangeWithAutoSave('widget_color', e.target.value)}
                  placeholder="#06B6D4"
                  style={{ flex: 1 }}
                />
              </div>
            </div>
          </div>
          
          <div style={{
            padding: 'var(--space-4)',
            background: 'var(--color-bg-tertiary)',
            borderRadius: 'var(--radius-md)',
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-3)',
          }}>
            <div style={{
              width: '48px',
              height: '48px',
              background: settings.widget_color,
              borderRadius: 'var(--radius-full)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
            </div>
            <div>
              <div style={{ fontWeight: 600, color: 'var(--color-text-primary)' }}>
                {settings.widget_title}
              </div>
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
                {t('labels.previewEffect')}
              </div>
            </div>
          </div>
        </div>

        <div className="glass-card" style={{
          padding: 'var(--space-6)',
          marginBottom: 'var(--space-6)',
        }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-3)',
            marginBottom: 'var(--space-4)',
          }}>
            <div style={{
              width: '40px',
              height: '40px',
              background: 'linear-gradient(135deg, #06B6D4, #3B82F6)',
              borderRadius: 'var(--radius-md)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
            </div>
            <div>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-2)',
              }}>
                <h2 style={{
                  fontSize: 'var(--text-lg)',
                  fontWeight: 600,
                  color: 'var(--color-text-primary)',
                }}>
                  {t('labels.welcomeMessageSettings')}
                </h2>
                <HelpTooltip
                  title={t('labels.welcomeMessageSettings')}
                  content={[
                    t('labels.welcomeMessageSettingsDesc'),
                    t('labels.welcomeMessageTip1'),
                    t('labels.welcomeMessageTip2'),
                    t('labels.welcomeMessageExample')
                  ]}
                  position="top"
                  size="sm"
                />
              </div>
              <p style={{
                fontSize: 'var(--text-sm)',
                color: 'var(--color-text-muted)',
              }}>
                {t('labels.firstMessageDesc')}
              </p>
            </div>
          </div>
          
          <textarea
            value={settings.welcome_message}
            onChange={(e) => handleChangeWithAutoSave('welcome_message', e.target.value)}
            rows={3}
            placeholder={t('labels.welcomeMessage')}
            style={{
              width: '100%',
              resize: 'vertical',
            }}
          />
        </div>

        <div className="glass-card" style={{
          padding: 'var(--space-6)',
          marginBottom: 'var(--space-6)',
        }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-3)',
            marginBottom: 'var(--space-4)',
          }}>
            <div style={{
              width: '40px',
              height: '40px',
              background: 'linear-gradient(135deg, #F59E0B, #EF4444)',
              borderRadius: 'var(--radius-md)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
            </div>
            <div>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-2)',
              }}>
                <h2 style={{
                  fontSize: 'var(--text-lg)',
                  fontWeight: 600,
                  color: 'var(--color-text-primary)',
                }}>
                  {t('labels.historyRetention')}
                </h2>
                <HelpTooltip
                  title={t('labels.historyRetention')}
                  content={[
                    t('labels.historyRetentionDesc'),
                    t('labels.historyRetentionTip1'),
                    t('labels.historyRetentionTip2'),
                    t('labels.historyRetentionTip3')
                  ]}
                  position="top"
                  size="sm"
                />
              </div>
              <p style={{
                fontSize: 'var(--text-sm)',
                color: 'var(--color-text-muted)',
              }}>
                {t('labels.historyRetentionWarning')}
              </p>
            </div>
          </div>

          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-4)',
          }}>
            <input
              type="number"
              value={settings.history_days}
              onChange={(e) => handleChangeWithAutoSave('history_days', Math.max(1, parseInt(e.target.value) || 30))}
              min={1}
              max={365}
              style={{
                width: '120px',
              }}
            />
            <span style={{
              color: 'var(--color-text-secondary)',
              fontSize: 'var(--text-sm)',
            }}>
              {t('labels.days')}
            </span>
          </div>
          <p style={{
            marginTop: 'var(--space-2)',
            fontSize: 'var(--text-xs)',
            color: 'var(--color-text-muted)',
          }}>
            {t('labels.historyRetentionAdvice')}
          </p>
        </div>

        <div className="glass-card" style={{
          padding: 'var(--space-6)',
          marginBottom: 'var(--space-6)',
        }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-3)',
            marginBottom: 'var(--space-4)',
          }}>
            <div style={{
              width: '40px',
              height: '40px',
              background: 'linear-gradient(135deg, #EC4899, #8B5CF6)',
              borderRadius: 'var(--radius-md)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
                <path d="M12 8v4l3 3" />
                <circle cx="12" cy="12" r="9" />
              </svg>
            </div>
            <div>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-2)',
              }}>
                <h2 style={{
                  fontSize: 'var(--text-lg)',
                  fontWeight: 600,
                  color: 'var(--color-text-primary)',
                }}>
                  {t('labels.aiConversationLimit')}
                </h2>
                <HelpTooltip
                  title={t('labels.aiConversationLimit')}
                  content={[
                    t('labels.aiConversationLimitDesc'),
                    t('labels.limitTip1'),
                    t('labels.limitTip2'),
                    t('labels.limitTip3'),
                    t('labels.limitTip4')
                  ]}
                  position="top"
                  size="sm"
                />
              </div>
              <p style={{
                fontSize: 'var(--text-sm)',
                color: 'var(--color-text-muted)',
              }}>
                {t('labels.limitDesc')}
              </p>
            </div>
          </div>

          <div style={{
            display: 'grid',
            gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr',
            gap: 'var(--space-4)',
            marginBottom: 'var(--space-4)',
          }}>
            <div>
              <label style={{
                display: 'block',
                marginBottom: 'var(--space-2)',
                fontSize: 'var(--text-sm)',
                fontWeight: 500,
                color: 'var(--color-text-secondary)',
              }}>
                {t('labels.hourlyLimit')}
              </label>
              <input
                type="number"
                value={settings.rate_limit_per_hour}
                onChange={(e) => handleChangeWithAutoSave('rate_limit_per_hour', Math.max(0, parseInt(e.target.value, 10) || 0))}
                min={0}
                max={1000}
              />
              <p style={{
                marginTop: 'var(--space-2)',
                fontSize: 'var(--text-xs)',
                color: 'var(--color-text-muted)',
              }}>
                {t('labels.zeroMeansNoLimit')}
              </p>
            </div>

          </div>

          <div style={{ marginTop: 'var(--space-4)' }}>
            <label style={{
              display: 'block',
              marginBottom: 'var(--space-2)',
              fontSize: 'var(--text-sm)',
              fontWeight: 500,
              color: 'var(--color-text-secondary)',
            }}>
              {t('labels.restrictedReplyLabel')}
            </label>
            <textarea
              value={settings.restricted_reply}
              onChange={(e) => handleChangeWithAutoSave('restricted_reply', e.target.value)}
              rows={3}
              placeholder={t('labels.restrictedReplyPlaceholder')}
              style={{
                width: '100%',
                resize: 'vertical',
              }}
            />
            <p style={{
              marginTop: 'var(--space-2)',
              fontSize: 'var(--text-xs)',
              color: 'var(--color-text-muted)',
            }}>
              {t('labels.restrictedReplyDesc')}
            </p>
            </div>
        </div>

        <div className="glass-card" style={{
          padding: 'var(--space-6)',
          marginBottom: 'var(--space-6)',
        }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-3)',
            marginBottom: 'var(--space-4)',
          }}>
            <div style={{
              width: '40px',
              height: '40px',
              background: 'linear-gradient(135deg, #F97316, #EA580C)',
              borderRadius: 'var(--radius-md)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
                <path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm0 18a8 8 0 1 1 8-8 8 8 0 0 1-8 8z"/>
                <path d="M12 6a6 6 0 1 0 6 6 6 6 0 0 0-6-6z"/>
                <path d="M12 10a2 2 0 1 0 2 2 2 2 0 0 0-2-2z"/>
              </svg>
            </div>
            <div>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-2)',
              }}>
                <h2 style={{
                  fontSize: 'var(--text-lg)',
                  fontWeight: 600,
                  color: 'var(--color-text-primary)',
                }}>
                  {t('labels.botProtection')}
                </h2>
                <HelpTooltip
                  title={t('labels.botProtection')}
                  content={[
                    t('labels.botProtectionDesc'),
                    t('labels.enableTurnstile'),
                    t('labels.turnstileSiteKeyDesc'),
                    t('labels.turnstileSecretKeyDesc'),
                  ]}
                  position="top"
                  size="sm"
                />
              </div>
              <p style={{
                fontSize: 'var(--text-sm)',
                color: 'var(--color-text-muted)',
              }}>
                {t('labels.botProtectionShort')}
              </p>
            </div>
          </div>

          <div style={{
            padding: 'var(--space-3)',
            background: 'var(--color-bg-tertiary)',
            borderRadius: 'var(--radius-md)',
            marginBottom: 'var(--space-4)',
          }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}>
              <div>
                <div style={{
                  fontSize: 'var(--text-sm)',
                  fontWeight: 500,
                  color: 'var(--color-text-primary)',
                }}>
                  {t('labels.enableTurnstile')}
                </div>
                <div style={{
                  fontSize: 'var(--text-xs)',
                  color: 'var(--color-text-muted)',
                }}>
                  {t('labels.enableTurnstileDesc')}
                </div>
              </div>
              <button
                onClick={() => handleTurnstileChange('enable_turnstile', !settings.enable_turnstile)}
                style={{
                  width: '44px',
                  height: '24px',
                  borderRadius: '12px',
                  border: 'none',
                  background: settings.enable_turnstile ? 'var(--color-accent-primary)' : 'var(--color-bg-secondary)',
                  cursor: 'pointer',
                  position: 'relative',
                  transition: 'background 0.2s',
                }}
              >
                <span style={{
                  position: 'absolute',
                  top: '2px',
                  left: settings.enable_turnstile ? '22px' : '2px',
                  width: '20px',
                  height: '20px',
                  borderRadius: '10px',
                  background: 'white',
                  transition: 'left 0.2s',
                  boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
                }} />
              </button>
            </div>
          </div>

          {settings.enable_turnstile && (
            <div style={{
              display: 'grid',
              gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr',
              gap: 'var(--space-4)',
            }}>
              <div>
                <label style={{
                  display: 'block',
                  marginBottom: 'var(--space-2)',
                  fontSize: 'var(--text-sm)',
                  fontWeight: 500,
                  color: 'var(--color-text-secondary)',
                }}>
                  {t('labels.turnstileSiteKey')}
                </label>
                <input
                  type="text"
                  value={settings.turnstile_site_key}
                  onChange={(e) => handleTurnstileChange('turnstile_site_key', e.target.value)}
                  placeholder={t('placeholders.turnstileSiteKey')}
                />
                <p style={{
                  marginTop: 'var(--space-2)',
                  fontSize: 'var(--text-xs)',
                  color: 'var(--color-text-muted)',
                }}>
                  {t('labels.turnstileSiteKeyDesc')}
                </p>
              </div>
              <div>
                <label style={{
                  display: 'block',
                  marginBottom: 'var(--space-2)',
                  fontSize: 'var(--text-sm)',
                  fontWeight: 500,
                  color: 'var(--color-text-secondary)',
                }}>
                  {t('labels.turnstileSecretKey')}
                </label>
                <input
                  type="password"
                  value={settings.turnstile_secret_key}
                  onChange={(e) => handleTurnstileChange('turnstile_secret_key', e.target.value)}
                  placeholder={settings.turnstile_secret_key_set ? t('labels.turnstileSecretConfigured') : t('placeholders.turnstileSecretKey')}
                />
                <p style={{
                  marginTop: 'var(--space-2)',
                  fontSize: 'var(--text-xs)',
                  color: 'var(--color-text-muted)',
                }}>
                  {t('labels.turnstileSecretKeyDesc')}
                  {settings.turnstile_secret_key_set ? ` · ${t('labels.turnstileSecretConfigured')}` : ''}
                </p>
              </div>
            </div>
          )}
        </div>

        <div className="glass-card" style={{
          padding: 'var(--space-6)',
          marginBottom: 'var(--space-6)',
        }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-3)',
            marginBottom: 'var(--space-4)',
          }}>
            <div style={{
              width: '40px',
              height: '40px',
              background: 'linear-gradient(135deg, #10B981, #059669)',
              borderRadius: 'var(--radius-md)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
                <polyline points="16 18 22 12 16 6" />
                <polyline points="8 6 2 12 8 18" />
              </svg>
            </div>
            <div>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-2)',
              }}>
                <h2 style={{
                  fontSize: 'var(--text-lg)',
                  fontWeight: 600,
                  color: 'var(--color-text-primary)',
                }}>
                  {t('labels.embedCode')}
                </h2>
                <HelpTooltip
                  title={t('labels.widgetEmbedCode')}
                  content={[
                    t('labels.embedCodeDesc'),
                    t('labels.embedCodeTip1'),
                    t('labels.embedCodeTip2'),
                    t('labels.embedCodeTip3'),
                    t('labels.embedCodeTip4')
                  ]}
                  position="top"
                  size="sm"
                />
              </div>
              <p style={{
                fontSize: 'var(--text-sm)',
                color: 'var(--color-text-muted)',
              }}>
                {t('labels.embedCodeFinal')}
              </p>
            </div>
          </div>

          {settings.agent_id && (
            <button
              onClick={handleCopyAgentId}
              className="btn-secondary"
              style={{
                width: '100%',
                marginBottom: 'var(--space-4)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 'var(--space-3)',
                padding: 'var(--space-3) var(--space-4)',
                textAlign: 'left',
                background: agentIdCopied ? 'rgba(16, 185, 129, 0.1)' : 'var(--color-bg-secondary)',
                borderColor: agentIdCopied ? 'rgba(16, 185, 129, 0.3)' : undefined,
              }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
                  Agent ID
                </span>
                <code style={{
                  fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Consolas, monospace',
                  fontSize: 'var(--text-sm)',
                  color: 'var(--color-text-primary)',
                  wordBreak: 'break-all',
                }}>
                  {settings.agent_id}
                </code>
              </div>
              <span style={{
                fontSize: 'var(--text-xs)',
                color: agentIdCopied ? '#10B981' : 'var(--color-text-muted)',
                flexShrink: 0,
              }}>
                {agentIdCopied ? t('status.success') : t('buttons.copy')}
              </span>
            </button>
          )}

          <div style={{
            background: 'var(--color-bg-tertiary)',
            borderRadius: 'var(--radius-md)',
            padding: 'var(--space-4)',
            position: 'relative',
            marginBottom: 'var(--space-4)',
          }}>
            <pre style={{
              margin: 0,
              fontSize: 'var(--text-xs)',
              color: 'var(--color-text-secondary)',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
              fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Consolas, "Liberation Mono", Menlo, monospace',
              lineHeight: 1.6,
            }}>
              {getEmbedCode()}
            </pre>
          </div>
          
          <button
            onClick={handleCopyEmbedCode}
            className="btn-secondary"
            style={{
              width: '100%',
              padding: 'var(--space-3)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 'var(--space-2)',
              background: copied ? 'rgba(16, 185, 129, 0.1)' : undefined,
              borderColor: copied ? 'rgba(16, 185, 129, 0.3)' : undefined,
              color: copied ? '#10B981' : undefined,
            }}
          >
            {copied ? (
              <>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                {t('status.success')}
              </>
            ) : (
              <>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
                {t('buttons.copy')}
              </>
            )}
          </button>
        </div>
      </div>
    </AdminLayout>
  )
}
