'use client'

import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import AdminLayout from '../components/AdminLayout'
import { Agent, api } from '../services/api'
import { useIsMobile } from '../hooks/useMediaQuery'

const agentTypeLabelKeys: Record<string, string> = {
  website_support: 'agents.types.websiteSupport',
  ai_clone: 'agents.types.aiClone',
  sales_outreach: 'agents.types.salesOutreach',
  custom: 'agents.types.custom',
}

const channelModeLabelKeys: Record<string, string> = {
  web_widget: 'agents.channels.webWidget',
  whatsapp: 'agents.channels.whatsapp',
  email: 'agents.channels.email',
  custom: 'agents.channels.custom',
}

export default function AgentPanel() {
  const { t } = useTranslation('common')
  const navigate = useNavigate()
  const isMobile = useIsMobile()
  const [agents, setAgents] = useState<Agent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.listAgents()
      .then(data => setAgents(data.agents.filter(agent => !agent.deleted_at)))
      .catch(err => setError(err instanceof Error ? err.message : t('errors.networkError')))
      .finally(() => setLoading(false))
  }, [t])

  return (
    <AdminLayout>
      <div style={{ padding: isMobile ? 'var(--space-4)' : 'var(--space-8)', maxWidth: 1400, margin: '0 auto' }}>
        <header style={{ marginBottom: 'var(--space-6)' }}>
          <h1 style={{ fontSize: isMobile ? 'var(--text-2xl)' : 'var(--text-4xl)', fontWeight: 700, color: 'var(--color-text-primary)', marginBottom: 'var(--space-2)' }}>
            {t('agents.panelTitle')}
          </h1>
          <p style={{ color: 'var(--color-text-secondary)' }}>{t('agents.panelSubtitle')}</p>
        </header>

        {error && (
          <div style={{ padding: 'var(--space-4)', border: '1px solid rgba(239,68,68,.3)', background: 'rgba(239,68,68,.08)', color: 'var(--color-error)', borderRadius: 'var(--radius-md)', marginBottom: 'var(--space-5)' }}>
            {error}
          </div>
        )}

        {loading ? (
          <div style={{ color: 'var(--color-text-muted)' }}>{t('status.loading')}</div>
        ) : agents.length === 0 ? (
          <section className="liquid-glass-card" style={{ padding: 'var(--space-8)', textAlign: 'center' }}>
            <h2 style={{ color: 'var(--color-text-primary)', marginBottom: 'var(--space-3)' }}>{t('agents.empty')}</h2>
            <button onClick={() => navigate('/agents')} style={{ border: 'none', borderRadius: 'var(--radius-md)', background: 'var(--color-accent-gradient)', color: 'var(--color-text-inverse)', padding: 'var(--space-3) var(--space-5)', fontWeight: 700, cursor: 'pointer' }}>
              {t('agents.create')}
            </button>
          </section>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'minmax(0, 1fr)' : 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))', gap: 'var(--space-4)', alignItems: 'stretch' }}>
            {agents.map(agent => (
              <button
                key={agent.id}
                onClick={() => navigate(`/agents/${agent.id}/dashboard`)}
                className="liquid-glass-card"
                style={{
                  textAlign: 'left',
                  padding: 'var(--space-5)',
                  border: '1px solid var(--color-border)',
                  cursor: 'pointer',
                  color: 'inherit',
                  width: '100%',
                  minWidth: 0,
                  overflow: 'hidden',
                  display: 'flex',
                  flexDirection: 'column',
                }}
              >
                <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', alignItems: 'start', gap: 'var(--space-3)', marginBottom: 'var(--space-4)' }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{
                      color: 'var(--color-text-primary)',
                      fontSize: 'var(--text-xl)',
                      fontWeight: 700,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}>
                      {agent.name}
                    </div>
                    <div style={{
                      color: 'var(--color-text-muted)',
                      fontSize: 'var(--text-xs)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}>
                      {t(agentTypeLabelKeys[agent.agent_type || 'custom'] || 'agents.types.custom')} / {t(channelModeLabelKeys[agent.channel_mode || 'custom'] || 'agents.channels.custom')}
                    </div>
                  </div>
                  <span style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    maxWidth: 96,
                    minWidth: 0,
                    padding: '2px var(--space-2)',
                    borderRadius: '999px',
                    background: agent.last_error_code ? 'rgba(239, 68, 68, 0.10)' : 'rgba(16, 185, 129, 0.10)',
                    color: agent.last_error_code ? 'var(--color-error)' : 'var(--color-success)',
                    fontSize: 'var(--text-xs)',
                    fontWeight: 700,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}>
                    {agent.last_error_code ? t('status.error') : t('status.running')}
                  </span>
                </div>
                <p style={{
                  color: 'var(--color-text-secondary)',
                  minHeight: 42,
                  marginBottom: 'var(--space-4)',
                  fontSize: 'var(--text-sm)',
                  lineHeight: 1.5,
                  overflow: 'hidden',
                  display: '-webkit-box',
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical',
                  wordBreak: 'break-word',
                }}>
                  {agent.description || t('agents.noDescription')}
                </p>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(88px, 1fr))', gap: 'var(--space-3)', marginTop: 'auto', minWidth: 0 }}>
                  <Metric label={t('navigation.urlKnowledge')} value={agent.url_count ?? 0} />
                  <Metric label={t('navigation.fileManagement')} value={agent.file_count ?? 0} />
                  <Metric label={t('navigation.sessions')} value={agent.active_session_count ?? 0} />
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </AdminLayout>
  )
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: 'var(--space-3)', background: 'var(--color-bg-secondary)', minWidth: 0, overflow: 'hidden' }}>
      <div style={{ color: 'var(--color-text-primary)', fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value}</div>
      <div style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-xs)', lineHeight: 1.25, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', wordBreak: 'break-word' }}>{label}</div>
    </div>
  )
}
