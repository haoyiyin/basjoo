'use client'

import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import AdminLayout from '../components/AdminLayout'
import { Agent, api } from '../services/api'
import { useAuth } from '../context/AuthContext'
import { useIsMobile } from '../hooks/useMediaQuery'

export default function AgentSelector() {
  const { t } = useTranslation('common')
  const navigate = useNavigate()
  const isMobile = useIsMobile()
  const { admin } = useAuth()
  const [agents, setAgents] = useState<Agent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const isSupport = admin?.role === 'support'

  // Loading timeout: prevent infinite "loading..." display
  useEffect(() => {
    const timeout = setTimeout(() => {
      if (loading) {
        setLoading(false)
        setError(t('common.loadingTimeout'))
      }
    }, 10000)
    return () => clearTimeout(timeout)
  }, [loading, t])

  useEffect(() => {
    api.listAgents()
      .then(data => {
        // Filter to only active, non-deleted agents
        const activeAgents = data.agents.filter(agent => !agent.deleted_at && agent.is_active)
        setAgents(activeAgents)

        // Auto-redirect if exactly one agent
        if (activeAgents.length === 1) {
          const agent = activeAgents[0]
          if (isSupport) {
            navigate(`/agents/${agent.id}/sessions`, { replace: true })
          } else {
            navigate(`/agents/${agent.id}/dashboard`, { replace: true })
          }
        }
      })
      .catch(err => setError(err instanceof Error ? err.message : t('errors.networkError')))
      .finally(() => setLoading(false))
  }, [t, navigate, isSupport])

  if (loading) {
    return (
      <AdminLayout>
        <div style={{ padding: isMobile ? 'var(--space-4)' : 'var(--space-8)', maxWidth: 800, margin: '0 auto' }}>
          <div style={{ color: 'var(--color-text-muted)' }}>{t('status.loading')}</div>
        </div>
      </AdminLayout>
    )
  }

  if (error) {
    return (
      <AdminLayout>
        <div style={{ padding: isMobile ? 'var(--space-4)' : 'var(--space-8)', maxWidth: 800, margin: '0 auto' }}>
          <div style={{
            padding: 'var(--space-4)',
            border: '1px solid rgba(239,68,68,.3)',
            background: 'rgba(239,68,68,.08)',
            color: 'var(--color-error)',
            borderRadius: 'var(--radius-md)',
          }}>
            {error}
          </div>
        </div>
      </AdminLayout>
    )
  }

  if (agents.length === 0) {
    return (
      <AdminLayout>
        <div style={{ padding: isMobile ? 'var(--space-4)' : 'var(--space-8)', maxWidth: 800, margin: '0 auto' }}>
          <section className="liquid-glass-card" style={{ padding: 'var(--space-8)', textAlign: 'center' }}>
            <h2 style={{ color: 'var(--color-text-primary)', marginBottom: 'var(--space-3)' }}>
              {t('agents.noAssigned')}
            </h2>
            <p style={{ color: 'var(--color-text-secondary)' }}>
              {t('agents.contactSuperAdmin')}
            </p>
          </section>
        </div>
      </AdminLayout>
    )
  }

  const handleSelect = (agent: Agent) => {
    if (isSupport) {
      navigate(`/agents/${agent.id}/sessions`)
    } else {
      navigate(`/agents/${agent.id}/dashboard`)
    }
  }

  return (
    <AdminLayout>
      <div style={{ padding: isMobile ? 'var(--space-4)' : 'var(--space-8)', maxWidth: 800, margin: '0 auto' }}>
        <header style={{ marginBottom: 'var(--space-6)' }}>
          <h1 style={{ fontSize: isMobile ? 'var(--text-2xl)' : 'var(--text-4xl)', fontWeight: 700, color: 'var(--color-text-primary)', marginBottom: 'var(--space-2)' }}>
            {t('agents.selectAgent')}
          </h1>
          <p style={{ color: 'var(--color-text-secondary)' }}>
            {isSupport ? t('agents.selectForSessions') : t('agents.selectForDashboard')}
          </p>
        </header>

        <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
          {agents.map(agent => (
            <button
              key={agent.id}
              onClick={() => handleSelect(agent)}
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
              {agent.description && (
                <p style={{
                  color: 'var(--color-text-secondary)',
                  fontSize: 'var(--text-sm)',
                  marginTop: 'var(--space-2)',
                  overflow: 'hidden',
                  display: '-webkit-box',
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical',
                  wordBreak: 'break-word',
                }}>
                  {agent.description}
                </p>
              )}
            </button>
          ))}
        </div>
      </div>
    </AdminLayout>
  )
}