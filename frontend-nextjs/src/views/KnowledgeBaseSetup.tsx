'use client'

import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { api } from '../services/api'
import type { EmbeddingProvider } from '../services/api'
import KBSetupWizard from '../components/KBSetupWizard'

type KBStatus = Awaited<ReturnType<typeof api.kbStatus>>

interface KnowledgeBaseSetupProps {
  agentId?: string
  onSetupComplete?: () => void
}

export default function KnowledgeBaseSetup({ agentId: agentIdProp, onSetupComplete }: KnowledgeBaseSetupProps) {
  const { t } = useTranslation('common')
  const navigate = useNavigate()
  const [agentId, setAgentId] = useState<string | null>(agentIdProp || null)
  const [kbStatus, setKbStatus] = useState<KBStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Action state
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
    if (!agentIdProp) {
      api.getDefaultAgent().then(agent => {
        setAgentId(agent.id)
      }).catch(() => {
        setError(t('errors.loadFailed'))
        setLoading(false)
      })
    }
  }, [agentIdProp, t])

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
        return t('labels.embeddingProviderJina', 'Jina')
      case 'siliconflow':
        return t('labels.embeddingProviderSiliconFlow', 'SiliconFlow')
      case 'custom':
        return t('labels.embeddingProviderCustom', 'Custom')
      default:
        return p
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center items-center py-12">
        <div className="spinner" />
      </div>
    )
  }

  // State B: Locked
  if (kbStatus?.kb_setup_completed) {
    return (
      <div className="flex flex-col gap-4">
        {/* R2R notice banner */}
        <div
          className="flex items-start gap-3 p-3 rounded-md text-sm"
          style={{
            background: 'rgba(59, 130, 246, 0.08)',
            border: '1px solid rgba(59, 130, 246, 0.25)',
            color: '#3b82f6',
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="mt-0.5 flex-shrink-0">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="16" x2="12" y2="12" />
            <line x1="12" y1="8" x2="12.01" y2="8" />
          </svg>
          <span>{t('kb.r2rNotice', 'Embedding 配置由 R2R 管理。更改设置后需要重启 R2R 容器（`docker compose restart r2r`）才能生效。')}</span>
        </div>

        {error && (
          <div
            className="p-3 rounded-md text-sm"
            style={{
              background: 'rgba(239, 68, 68, 0.1)',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              color: '#ef4444',
            }}
          >
            {error}
          </div>
        )}

        <div className="glass-card p-6">
          <div className="flex items-center justify-between mb-4">
            <h3
              className="text-lg font-semibold"
              style={{ color: 'var(--color-text-primary)' }}
            >
              {t('kb.setup.title', '知识库设置')}
            </h3>
            <span
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium"
              style={{
                background: 'rgba(16, 185, 129, 0.12)',
                color: '#10b981',
                border: '1px solid rgba(16, 185, 129, 0.25)',
              }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
              {t('kb.locked', '已锁定')}
            </span>
          </div>

          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between py-2 border-b" style={{ borderColor: 'var(--color-border)' }}>
              <span className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                {t('kb.provider', 'Embedding Provider')}
              </span>
              <span className="text-sm font-medium" style={{ color: 'var(--color-text-primary)' }}>
                {getProviderLabel(kbStatus.embedding_provider)}
              </span>
            </div>

            <div className="flex items-center justify-between py-2 border-b" style={{ borderColor: 'var(--color-border)' }}>
              <span className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                {t('kb.model', 'Model')}
              </span>
              <span className="text-sm font-medium" style={{ color: 'var(--color-text-primary)' }}>
                {kbStatus.embedding_model}
              </span>
            </div>

            <div className="flex items-center justify-between py-2">
              <span className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                {t('kb.apiKeyStatus', 'API Key')}
              </span>
              <span
                className="text-sm font-medium"
                style={{ color: kbStatus.embedding_api_key_set ? '#10b981' : '#ef4444' }}
              >
                {kbStatus.embedding_api_key_set
                  ? t('labels.configured', '已配置')
                  : t('kb.notConfigured', '未配置')}
              </span>
            </div>
          </div>

          <div className="mt-6">
            <button
              onClick={() => setShowResetDialog(true)}
              className="btn-secondary"
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                color: '#ef4444',
                borderColor: 'rgba(239, 68, 68, 0.3)',
                padding: '12px',
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="1 4 1 10 7 10" />
                <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
              </svg>
              {t('kb.resetEmbedding', '重置 Embedding')}
            </button>
          </div>
        </div>

        {/* Navigation cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: 'var(--space-4)' }}>
          <div
            className="glass-card"
            style={{ padding: 'var(--space-5)', cursor: 'pointer', transition: 'all 0.2s' }}
            onClick={() => navigate('/urls')}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginBottom: 'var(--space-2)' }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent-primary)" strokeWidth="2">
                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
              </svg>
              <span style={{ fontWeight: 600, color: 'var(--color-text-primary)' }}>{t('navigation.urlKnowledge')}</span>
            </div>
            <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>{t('kb.manageUrlsDesc', '管理网站知识源，添加和抓取网页内容')}</p>
          </div>
          <div
            className="glass-card"
            style={{ padding: 'var(--space-5)', cursor: 'pointer', transition: 'all 0.2s' }}
            onClick={() => navigate('/files')}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginBottom: 'var(--space-2)' }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent-primary)" strokeWidth="2">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
              </svg>
              <span style={{ fontWeight: 600, color: 'var(--color-text-primary)' }}>{t('navigation.fileManagement')}</span>
            </div>
            <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>{t('kb.manageFilesDesc', '上传和管理文件，支持 PDF、TXT、CSV 等格式')}</p>
          </div>
        </div>

        {/* Reset confirmation dialog */}
        {showResetDialog && (
          <div
            className="fixed inset-0 flex items-center justify-center"
            style={{ zIndex: 9999, background: 'rgba(0, 0, 0, 0.5)' }}
            onClick={() => setShowResetDialog(false)}
          >
            <div
              className="rounded-lg p-6 max-w-md w-full mx-4"
              style={{
                background: 'var(--color-bg-primary)',
                border: '1px solid var(--color-border)',
                boxShadow: '0 20px 60px rgba(0, 0, 0, 0.3)',
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start gap-3 mb-4">
                <div
                  className="flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center"
                  style={{ background: 'rgba(239, 68, 68, 0.12)' }}
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2">
                    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                    <line x1="12" y1="9" x2="12" y2="13" />
                    <line x1="12" y1="17" x2="12.01" y2="17" />
                  </svg>
                </div>
                <div>
                  <h3
                    className="text-base font-semibold mb-2"
                    style={{ color: 'var(--color-text-primary)' }}
                  >
                    {t('kb.resetConfirmTitle', '重置 Embedding 配置')}
                  </h3>
                  <p
                    className="text-sm"
                    style={{ color: 'var(--color-text-secondary)' }}
                  >
                    {t('kb.resetConfirmMessage', '索引需要重构，所有文件需要重新上传。确定要重置吗？')}
                  </p>
                </div>
              </div>

              <div className="flex gap-3 justify-end mt-6">
                <button
                  onClick={() => setShowResetDialog(false)}
                  className="btn-secondary"
                  disabled={resetting}
                >
                  {t('buttons.cancel', '取消')}
                </button>
                <button
                  onClick={handleReset}
                  disabled={resetting}
                  style={{
                    padding: '8px 16px',
                    borderRadius: 'var(--radius-md)',
                    border: 'none',
                    background: '#ef4444',
                    color: 'white',
                    fontWeight: 500,
                    fontSize: 'var(--text-sm)',
                    cursor: resetting ? 'not-allowed' : 'pointer',
                    opacity: resetting ? 0.7 : 1,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                  }}
                >
                  {resetting && <div className="spinner" style={{ width: '14px', height: '14px', borderWidth: '2px' }} />}
                  {t('buttons.confirm', '确定')}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    )
  }

  // State A: Not set up
  return (
    <KBSetupWizard
      agentId={agentId!}
      onSetupComplete={() => {
        fetchKBStatus()
        onSetupComplete?.()
      }}
    />
  )
}
