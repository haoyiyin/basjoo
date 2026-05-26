'use client'

import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useParams } from 'react-router-dom'
import { api } from '../services/api'
import type { EmbeddingProvider } from '../services/api'
import KBSetupWizard from '../components/KBSetupWizard'
import AdminLayout from '../components/AdminLayout'

type KBStatus = Awaited<ReturnType<typeof api.kbStatus>>

interface KnowledgeBaseSetupProps {
  agentId?: string
  onSetupComplete?: () => void
}

export default function KnowledgeBaseSetup({ agentId: agentIdProp, onSetupComplete }: KnowledgeBaseSetupProps) {
  const { t } = useTranslation('common')
  const { agentId: routeAgentId } = useParams<{ agentId?: string }>()
  const [agentId, setAgentId] = useState<string | null>(agentIdProp || routeAgentId || null)
  const [kbStatus, setKbStatus] = useState<KBStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [resetting, setResetting] = useState(false)
  const [showResetDialog, setShowResetDialog] = useState(false)

  const fetchKBStatus = useCallback(async () => {
    if (!agentId) return
    try {
      setLoading(true)
      setError(null)
      const result = await api.kbStatus(agentId)
      setKbStatus(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errors.loadFailed'))
    } finally {
      setLoading(false)
    }
  }, [agentId, t])

  useEffect(() => {
    const resolvedAgentId = agentIdProp || routeAgentId
    if (resolvedAgentId) {
      setAgentId(resolvedAgentId)
    } else {
      setError(t('errors.loadFailed'))
      setLoading(false)
    }
  }, [agentIdProp, routeAgentId, t])

  useEffect(() => {
    if (agentId) {
      fetchKBStatus()
    }
  }, [agentId, fetchKBStatus])

  const handleReset = async () => {
    if (!agentId) return
    setResetting(true)
    setError(null)

    try {
      await api.kbReset(agentId)
      setShowResetDialog(false)
      await fetchKBStatus()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errors.saveFailed'))
    } finally {
      setResetting(false)
    }
  }

  const getProviderLabel = (p: EmbeddingProvider): string => {
    switch (p) {
      case 'r2r':
        return 'R2R'
      case 'jina':
        return t('labels.embeddingProviderJina')
      case 'siliconflow':
        return t('labels.embeddingProviderSiliconFlow')
      case 'custom':
        return t('labels.embeddingProviderCustom')
      default:
        return p
    }
  }

  if (loading) {
    return (
      <AdminLayout>
        <div style={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          minHeight: '300px',
        }}>
          <div className="spinner" />
        </div>
      </AdminLayout>
    )
  }

  // Locked state
  if (kbStatus?.kb_setup_completed) {
    return (
      <AdminLayout>
        <div style={{
          padding: 'var(--space-8)',
          maxWidth: '1400px',
          margin: '0 auto',
        }}>
          {/* Page header */}
          <div style={{ marginBottom: 'var(--space-6)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginBottom: 'var(--space-2)' }}>
              <h1 style={{
                fontSize: 'var(--text-2xl)',
                fontWeight: 700,
                color: 'var(--color-text-primary)',
                margin: 0,
              }}>
                {t('kb.title')}
              </h1>
              <span className="badge badge-success">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ marginRight: '4px' }}>
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
                {t('kb.locked')}
              </span>
            </div>
            <p style={{
              fontSize: 'var(--text-base)',
              color: 'var(--color-text-secondary)',
              margin: 0,
            }}>
              {t('kb.lockedDescription')}
            </p>
          </div>

          {error && (
            <div style={{
              padding: 'var(--space-3) var(--space-4)',
              borderRadius: 'var(--radius-md)',
              fontSize: 'var(--text-sm)',
              background: 'var(--color-error-bg)',
              border: '1px solid var(--color-error)',
              color: 'var(--color-error)',
              marginBottom: 'var(--space-4)',
            }}>
              {error}
            </div>
          )}

          <div className="liquid-glass-card" style={{ padding: 'var(--space-6)' }}>
            <h3 style={{
              fontSize: 'var(--text-lg)',
              fontWeight: 600,
              marginBottom: 'var(--space-4)',
              color: 'var(--color-text-primary)',
            }}>
              {t('kb.title')}
            </h3>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: 'var(--space-3) 0',
                borderBottom: '1px solid var(--color-border)',
              }}>
                <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>
                  {t('kb.provider')}
                </span>
                <span style={{ fontSize: 'var(--text-sm)', fontWeight: 500, color: 'var(--color-text-primary)' }}>
                  {getProviderLabel(kbStatus.embedding_provider)}
                </span>
              </div>

              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: 'var(--space-3) 0',
                borderBottom: '1px solid var(--color-border)',
              }}>
                <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>
                  {t('kb.modelName')}
                </span>
                <span style={{ fontSize: 'var(--text-sm)', fontWeight: 500, color: 'var(--color-text-primary)' }}>
                  {kbStatus.embedding_model}
                </span>
              </div>

              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: 'var(--space-3) 0',
              }}>
                <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>
                  {t('kb.apiKey')}
                </span>
                <span style={{
                  fontSize: 'var(--text-sm)',
                  fontWeight: 500,
                  color: kbStatus.embedding_api_key_set ? 'var(--color-success)' : 'var(--color-error)',
                }}>
                  {kbStatus.embedding_api_key_set
                    ? t('status.configured')
                    : t('status.notConfigured')}
                </span>
              </div>
            </div>

            <div style={{ marginTop: 'var(--space-6)' }}>
              <button
                onClick={() => setShowResetDialog(true)}
                className="btn-danger"
                style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="1 4 1 10 7 10" />
                  <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
                </svg>
                {t('kb.resetButton')}
              </button>
            </div>
          </div>

          {/* Reset confirmation dialog */}
          {showResetDialog && (
            <div
              style={{
                position: 'fixed',
                inset: 0,
                zIndex: 9999,
                background: 'rgba(0, 0, 0, 0.5)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
              onClick={() => setShowResetDialog(false)}
            >
              <div
                className="liquid-glass-card"
                style={{
                  padding: 'var(--space-6)',
                  maxWidth: '420px',
                  width: '100%',
                  margin: '0 var(--space-4)',
                }}
                onClick={(e) => e.stopPropagation()}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-3)', marginBottom: 'var(--space-4)' }}>
                  <div style={{
                    flexShrink: 0,
                    width: '40px',
                    height: '40px',
                    borderRadius: 'var(--radius-full)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: 'var(--color-error-bg)',
                  }}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--color-error)" strokeWidth="2">
                      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                      <line x1="12" y1="9" x2="12" y2="13" />
                      <line x1="12" y1="17" x2="12.01" y2="17" />
                    </svg>
                  </div>
                  <div>
                    <h3 style={{
                      fontSize: 'var(--text-base)',
                      fontWeight: 600,
                      marginBottom: 'var(--space-2)',
                      color: 'var(--color-text-primary)',
                    }}>
                      {t('kb.resetConfirmTitle')}
                    </h3>
                    <p style={{
                      fontSize: 'var(--text-sm)',
                      color: 'var(--color-text-secondary)',
                    }}>
                      {t('kb.resetConfirmMessage')}
                    </p>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 'var(--space-3)', justifyContent: 'flex-end', marginTop: 'var(--space-6)' }}>
                  <button
                    onClick={() => setShowResetDialog(false)}
                    className="btn-secondary"
                    disabled={resetting}
                  >
                    {t('buttons.cancel')}
                  </button>
                  <button
                    onClick={handleReset}
                    disabled={resetting}
                    className="btn-danger"
                  >
                    {resetting && <div className="spinner" style={{ width: '14px', height: '14px', borderWidth: '2px' }} />}
                    {t('buttons.confirm')}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </AdminLayout>
    )
  }

  // Not set up — show wizard
  return (
    <AdminLayout>
      <div style={{
        padding: 'var(--space-8)',
        maxWidth: '1400px',
        margin: '0 auto',
      }}>
        <KBSetupWizard
          agentId={agentId!}
          onSetupComplete={() => {
            fetchKBStatus()
            onSetupComplete?.()
          }}
        />
      </div>
    </AdminLayout>
  )
}
