'use client'

import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import AdminLayout from '../components/AdminLayout'
import { Agent, api } from '../services/api'
import { useAuth } from '../context/AuthContext'

/**
 * Agent picker for non-workspace roles.
 *
 * A "support" user only ever lands here (and on the agent's sessions list), so
 * the screen is the whole navigation for that role: one `list` of agents, each
 * row a full-width button that opens the role-appropriate destination.
 *
 * Restyle (spec §20): the page scaffold, the `list`/`list-row` primitive and
 * the `empty` state replace the old glass cards and hand-mixed error banner.
 * The single-agent auto-redirect and the 10s loading-timeout fallback are
 * unchanged.
 */
export default function AgentSelector() {
  const { t } = useTranslation('common')
  const navigate = useNavigate()
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
        <div className="admin-page" data-testid="agent-selector-page">
          <div className="list" aria-busy="true" data-testid="agent-selector-loading">
            {[0, 1, 2].map(index => (
              <div key={index} className="list-row">
                <div className="skeleton skeleton-text" style={{ width: '100%' }} />
              </div>
            ))}
          </div>
        </div>
      </AdminLayout>
    )
  }

  if (error) {
    return (
      <AdminLayout>
        <div className="admin-page" data-testid="agent-selector-page">
          <div className="empty" data-testid="agent-selector-error">
            <p className="empty-title" role="alert">
              {error}
            </p>
          </div>
        </div>
      </AdminLayout>
    )
  }

  if (agents.length === 0) {
    return (
      <AdminLayout>
        <div className="admin-page" data-testid="agent-selector-page">
          <div className="empty" data-testid="agent-selector-empty">
            <p className="empty-title">{t('agents.noAssigned')}</p>
            <p className="empty-description">{t('agents.contactSuperAdmin')}</p>
          </div>
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
      <div className="admin-page" data-testid="agent-selector-page">
        <header className="page-header">
          <div style={{ minWidth: 0 }}>
            <h1 className="page-title">{t('agents.selectAgent')}</h1>
            <p className="page-subtitle">
              {isSupport ? t('agents.selectForSessions') : t('agents.selectForDashboard')}
            </p>
          </div>
        </header>

        <ul className="list" data-testid="agent-selector-list">
          {agents.map(agent => (
            <li key={agent.id} className="list-row">
              <button
                type="button"
                className="list-row-main"
                style={{
                  background: 'transparent',
                  border: 'none',
                  padding: 0,
                  textAlign: 'left',
                  cursor: 'pointer',
                  gap: 'var(--space-1)',
                }}
                onClick={() => handleSelect(agent)}
              >
                <span className="list-row-title">{agent.name}</span>
                {agent.description && (
                  <span
                    className="list-row-description"
                    style={{ whiteSpace: 'normal' }}
                  >
                    {agent.description}
                  </span>
                )}
              </button>
              <div className="list-row-meta">
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  aria-hidden="true"
                >
                  <path d="M9 18l6-6-6-6" />
                </svg>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </AdminLayout>
  )
}
