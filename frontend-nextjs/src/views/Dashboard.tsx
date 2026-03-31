'use client'

import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import AdminLayout from '../components/AdminLayout'
import { useState, useEffect } from 'react'
import { api } from '../services/api'
import { useTranslation } from 'react-i18next'
import { useIsMobile } from '../hooks/useMediaQuery'

interface QuickAction {
  titleKey: string
  descriptionKey: string
  path: string
  icon: JSX.Element
  gradient: string
}

const quickActionsConfig: QuickAction[] = [
  {
    titleKey: 'navigation.playground',
    descriptionKey: 'labels.testAiEffect',
    path: '/playground',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      </svg>
    ),
    gradient: 'linear-gradient(135deg, #06b6d4 0%, #0891b2 100%)',
  },
  {
    titleKey: 'navigation.qaManagement',
    descriptionKey: 'labels.manageQa',
    path: '/qa',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="10" />
        <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
    ),
    gradient: 'linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)',
  },
  {
    titleKey: 'navigation.urlKnowledge',
    descriptionKey: 'labels.addWebKnowledge',
    path: '/urls',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
      </svg>
    ),
    gradient: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
  },
]

export default function Dashboard() {
  const { t } = useTranslation('common')
  const navigate = useNavigate()
  const { admin } = useAuth()
  const isMobile = useIsMobile()
  const [quota, setQuota] = useState<{
    used_urls: number
    max_urls: number
    used_qa_items: number
    max_qa_items: number
    used_messages_today: number
    max_messages_per_day: number
  } | null>(null)
  const [sourcesSummary, setSourcesSummary] = useState<{
    urls: { total: number; indexed: number; pending: number }
    qa: { total: number; indexed: number; pending: number }
    has_pending: boolean
  } | null>(null)
  const [agentId, setAgentId] = useState<string | null>(null)
  const [agentIdCopied, setAgentIdCopied] = useState(false)

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    try {
      const agent = await api.getDefaultAgent()
      setAgentId(agent.id)
      const [quotaData, sourcesData] = await Promise.all([
        api.getQuota(agent.id),
        api.getSourcesSummary(agent.id),
      ])
      setQuota(quotaData)
      setSourcesSummary(sourcesData)
    } catch (error) {
      console.error('Failed to load data:', error)
    }
  }

  const getGreeting = () => {
    const hour = new Date().getHours()
    if (hour < 12) return t('time.goodMorning')
    if (hour < 18) return t('time.goodAfternoon')
    return t('time.goodEvening')
  }

  const handleCopyAgentId = async () => {
    if (!agentId) return
    try {
      await navigator.clipboard.writeText(agentId)
    } catch {
      const textArea = document.createElement('textarea')
      textArea.value = agentId
      document.body.appendChild(textArea)
      textArea.select()
      document.execCommand('copy')
      document.body.removeChild(textArea)
    }
    setAgentIdCopied(true)
    setTimeout(() => setAgentIdCopied(false), 2000)
  }

  return (
    <AdminLayout>
      <div style={{
        padding: isMobile ? 'var(--space-4)' : 'var(--space-8)',
        maxWidth: '1400px',
        margin: '0 auto',
      }}>
        <header style={{
          marginBottom: isMobile ? 'var(--space-6)' : 'var(--space-10)',
          animation: 'fadeIn 0.5s ease-out forwards',
        }}>
          <h1 style={{
            fontSize: isMobile ? 'var(--text-2xl)' : 'var(--text-4xl)',
            fontWeight: 700,
            marginBottom: 'var(--space-2)',
            background: 'var(--color-accent-gradient)',
            WebkitBackgroundClip: 'text',
            backgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
          }}>
            {getGreeting()}，{admin?.name}
          </h1>
          <p style={{
            fontSize: isMobile ? 'var(--text-base)' : 'var(--text-lg)',
            color: 'var(--color-text-secondary)',
          }}>
            {t('labels.welcome')}
          </p>
        </header>

        <div className="responsive-grid-3" style={{
          display: 'grid',
          gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, 1fr)',
          gap: 'var(--space-4)',
          marginBottom: isMobile ? 'var(--space-6)' : 'var(--space-10)',
        }}>
          {[
            {
              label: t('labels.urlKnowledgeSource'),
              value: sourcesSummary?.urls.total ?? 0,
              indexed: sourcesSummary?.urls.indexed ?? 0,
              color: 'var(--color-accent-primary)'
            },
            {
              label: t('labels.qaItems'),
              value: sourcesSummary?.qa.total ?? 0,
              indexed: sourcesSummary?.qa.indexed ?? 0,
              color: 'var(--color-accent-secondary)'
            },
            {
              label: t('labels.indexedDocBlocks'),
              value: sourcesSummary
                ? (sourcesSummary.urls.indexed + sourcesSummary.qa.indexed)
                : '-',
              color: 'var(--color-warning)'
            },
          ].map((stat, idx) => (
            <div
              key={idx}
              className="glass-card"
              style={{
                padding: 'var(--space-6)',
                animation: 'fadeIn 0.5s ease-out forwards',
                animationDelay: `${idx * 0.1}s`,
                opacity: 0,
              }}
            >
              <div style={{
                fontSize: 'var(--text-sm)',
                color: 'var(--color-text-muted)',
                marginBottom: 'var(--space-2)',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
              }}>
                {stat.label}
              </div>
              <div style={{
                display: 'flex',
                alignItems: 'baseline',
                gap: 'var(--space-2)',
              }}>
                <span style={{
                  fontSize: 'var(--text-3xl)',
                  fontWeight: 700,
                  color: stat.color,
                }}>
                  {stat.value}
                </span>
                {'indexed' in stat && typeof stat.indexed === 'number' && stat.indexed > 0 && (
                  <span style={{
                    fontSize: 'var(--text-sm)',
                    color: 'var(--color-text-muted)',
                  }}>
                    ({stat.indexed} {t('sources.trained')})
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>

        <section style={{ marginBottom: isMobile ? 'var(--space-6)' : 'var(--space-10)' }}>
          <h2 style={{
            fontSize: isMobile ? 'var(--text-lg)' : 'var(--text-xl)',
            fontWeight: 600,
            marginBottom: 'var(--space-6)',
            color: 'var(--color-text-primary)',
          }}>
            {t('labels.quickStart')}
          </h2>
          <div style={{
            display: 'grid',
            gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fit, minmax(280px, 1fr))',
            gap: 'var(--space-4)',
          }}>
            {quickActionsConfig.map((action, idx) => (
              <button
                key={action.path}
                onClick={() => navigate(action.path)}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 'var(--space-4)',
                  padding: 'var(--space-6)',
                  background: 'var(--color-bg-glass)',
                  backdropFilter: 'blur(var(--blur-md))',
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-lg)',
                  cursor: 'pointer',
                  textAlign: 'left',
                  transition: 'all var(--transition-fast)',
                  animation: 'fadeIn 0.5s ease-out forwards',
                  animationDelay: `${(idx + 4) * 0.1}s`,
                  opacity: 0,
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = 'translateY(-4px)'
                  e.currentTarget.style.boxShadow = 'var(--shadow-lg)'
                  e.currentTarget.style.borderColor = 'var(--color-border-hover)'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = 'translateY(0)'
                  e.currentTarget.style.boxShadow = 'none'
                  e.currentTarget.style.borderColor = 'var(--color-border)'
                }}
              >
                <div style={{
                  width: '48px',
                  height: '48px',
                  background: action.gradient,
                  borderRadius: 'var(--radius-md)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'white',
                  flexShrink: 0,
                }}>
                  {action.icon}
                </div>
                <div>
                  <h3 style={{
                    fontSize: 'var(--text-base)',
                    fontWeight: 600,
                    color: 'var(--color-text-primary)',
                    marginBottom: 'var(--space-1)',
                  }}>
                    {t(action.titleKey)}
                  </h3>
                  <p style={{
                    fontSize: 'var(--text-sm)',
                    color: 'var(--color-text-muted)',
                    margin: 0,
                  }}>
                    {t(action.descriptionKey)}
                  </p>
                </div>
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  style={{
                    marginLeft: 'auto',
                    color: 'var(--color-text-muted)',
                    flexShrink: 0,
                  }}
                >
                  <path d="M9 18l6-6-6-6" />
                </svg>
              </button>
            ))}
          </div>
        </section>

        <section>
          <h2 style={{
            fontSize: isMobile ? 'var(--text-lg)' : 'var(--text-xl)',
            fontWeight: 600,
            marginBottom: 'var(--space-6)',
            color: 'var(--color-text-primary)',
          }}>
            {t('labels.systemStatus')}
          </h2>
          <div className="glass-card" style={{
            padding: isMobile ? 'var(--space-4)' : 'var(--space-6)',
            animation: 'fadeIn 0.5s ease-out forwards',
            animationDelay: '0.8s',
            opacity: 0,
          }}>
            <div style={{
              display: 'grid',
              gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fit, minmax(200px, 1fr))',
              gap: 'var(--space-6)',
            }}>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-3)',
              }}>
                <div style={{
                  width: '10px',
                  height: '10px',
                  background: sourcesSummary && sourcesSummary.urls.indexed > 0 ? 'var(--color-success)' : 'var(--color-warning)',
                  borderRadius: 'var(--radius-full)',
                  boxShadow: sourcesSummary && sourcesSummary.urls.indexed > 0
                    ? '0 0 10px var(--color-success)'
                    : '0 0 10px var(--color-warning)',
                }} />
                <div>
                  <div style={{
                    fontSize: 'var(--text-sm)',
                    color: 'var(--color-text-muted)',
                  }}>
                    {t('labels.vectorIndex')}
                  </div>
                  <div style={{
                    fontSize: 'var(--text-base)',
                    fontWeight: 500,
                    color: 'var(--color-text-primary)',
                  }}>
                    {sourcesSummary && sourcesSummary.urls.indexed > 0 ? t('status.established') : t('status.notEstablished')}
                  </div>
                </div>
              </div>

              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-3)',
              }}>
                <div style={{
                  width: '10px',
                  height: '10px',
                  background: 'var(--color-success)',
                  borderRadius: 'var(--radius-full)',
                  boxShadow: '0 0 10px var(--color-success)',
                }} />
                <div>
                  <div style={{
                    fontSize: 'var(--text-sm)',
                    color: 'var(--color-text-muted)',
                  }}>
                    {t('labels.apiStatus')}
                  </div>
                  <div style={{
                    fontSize: 'var(--text-base)',
                    fontWeight: 500,
                    color: 'var(--color-text-primary)',
                  }}>
                    {t('labels.normalOperation')}
                  </div>
                </div>
              </div>

              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-3)',
              }}>
                <div style={{
                  width: '10px',
                  height: '10px',
                  background: agentId ? 'var(--color-success)' : 'var(--color-error)',
                  borderRadius: 'var(--radius-full)',
                  boxShadow: agentId 
                    ? '0 0 10px var(--color-success)' 
                    : '0 0 10px var(--color-error)',
                }} />
                <div>
                  <div style={{
                    fontSize: 'var(--text-sm)',
                    color: 'var(--color-text-muted)',
                  }}>
                    Agent
                  </div>
                  <div style={{
                    fontSize: 'var(--text-base)',
                    fontWeight: 500,
                    color: 'var(--color-text-primary)',
                  }}>
                    {agentId ? t('status.configured') : t('status.notConfigured')}
                  </div>
                  {agentId && (
                    <button
                      onClick={handleCopyAgentId}
                      style={{
                        marginTop: '4px',
                        padding: 0,
                        border: 'none',
                        background: 'transparent',
                        cursor: 'pointer',
                        fontSize: 'var(--text-xs)',
                        color: agentIdCopied ? 'var(--color-success)' : 'var(--color-text-muted)',
                        fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Consolas, monospace',
                        textAlign: 'left',
                        wordBreak: 'break-all',
                      }}
                      title={agentIdCopied ? t('status.success') : t('buttons.copy')}
                    >
                      {agentIdCopied ? `${t('status.success')}: ${agentId}` : `ID: ${agentId}`}
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </AdminLayout>
  )
}
