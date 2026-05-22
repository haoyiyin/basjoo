'use client'

import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../services/api'
import type { EmbeddingProvider } from '../services/api'

const PROVIDER_DEFAULT_MODELS: Record<EmbeddingProvider, string> = {
  r2r: 'jina-embeddings-v3',
  jina: 'jina-embeddings-v3',
  siliconflow: 'BAAI/bge-m3',
  custom: 'text-embedding-v4',
}

interface KBSetupWizardProps {
  agentId: string
  onSetupComplete: () => void
  onCancel?: () => void
}

export default function KBSetupWizard({ agentId, onSetupComplete, onCancel }: KBSetupWizardProps) {
  const { t } = useTranslation('common')
  const [provider, setProvider] = useState<EmbeddingProvider>('jina')
  const [apiKey, setApiKey] = useState('')
  const [showApiKey, setShowApiKey] = useState(false)
  const [modelName, setModelName] = useState(PROVIDER_DEFAULT_MODELS.jina)
  const [embeddingApiBase, setEmbeddingApiBase] = useState('')
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null)
  const [settingUp, setSettingUp] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setModelName(PROVIDER_DEFAULT_MODELS[provider])
    if (provider !== 'custom') {
      setEmbeddingApiBase('')
    }
  }, [provider])

  const handleTest = async () => {
    setTesting(true)
    setTestResult(null)
    setError(null)

    try {
      const overrides: Record<string, string> = {
        embedding_provider: provider,
        embedding_model: modelName,
      }

      if (provider === 'jina') {
        overrides.jina_api_key = apiKey
      } else {
        overrides.siliconflow_api_key = apiKey
      }

      if (provider === 'custom' && embeddingApiBase) {
        overrides.embedding_api_base = embeddingApiBase
      }

      const testFn = provider === 'jina'
        ? api.testJinaApi(agentId, overrides)
        : api.testEmbeddingApi(agentId, overrides)

      const result = await testFn
      setTestResult(result)
    } catch (err) {
      setTestResult({
        success: false,
        message: err instanceof Error ? err.message : t('errors.saveFailed'),
      })
    } finally {
      setTesting(false)
    }
  }

  const handleSetup = async () => {
    setSettingUp(true)
    setError(null)

    try {
      const config: Parameters<typeof api.kbSetup>[1] = {
        embedding_provider: provider,
        embedding_model: modelName,
      }

      if (provider === 'jina') {
        config.jina_api_key = apiKey
      } else {
        config.siliconflow_api_key = apiKey
      }

      if (provider === 'custom' && embeddingApiBase) {
        config.embedding_api_base = embeddingApiBase
      }

      await api.kbSetup(agentId, config)
      onSetupComplete()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errors.saveFailed'))
    } finally {
      setSettingUp(false)
    }
  }

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
        <h3
          className="text-lg font-semibold mb-1"
          style={{ color: 'var(--color-text-primary)' }}
        >
          {t('kb.setup.title', '知识库设置')}
        </h3>
        <p
          className="text-sm mb-6"
          style={{ color: 'var(--color-text-muted)' }}
        >
          {t('kb.setup.desc', '配置 Embedding 提供商以初始化知识库。设置后无法更改，只能重置。')}
        </p>

        <div className="flex flex-col gap-4">
          {/* Provider dropdown */}
          <div>
            <label
              className="block mb-2 text-sm font-medium"
              style={{ color: 'var(--color-text-secondary)' }}
            >
              {t('labels.embeddingProvider', 'Embedding Provider')}
            </label>
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value as EmbeddingProvider)}
              style={{
                width: '100%',
                padding: '10px',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--color-border)',
                background: 'var(--color-bg-primary)',
                color: 'var(--color-text-primary)',
                fontSize: 'var(--text-sm)',
                cursor: 'pointer',
              }}
            >
              <option value="jina">{t('labels.embeddingProviderJina', 'Jina')}</option>
              <option value="siliconflow">{t('labels.embeddingProviderSiliconFlow', 'SiliconFlow')}</option>
              <option value="custom">{t('labels.embeddingProviderCustom', 'Custom')}</option>
            </select>
          </div>

          {/* API Key with test button */}
          <div>
            <label
              className="block mb-2 text-sm font-medium"
              style={{ color: 'var(--color-text-secondary)' }}
            >
              {t('kb.apiKey', 'API Key')}
            </label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <input
                  type={showApiKey ? 'text' : 'password'}
                  value={apiKey}
                  onChange={(e) => {
                    setApiKey(e.target.value)
                    setTestResult(null)
                  }}
                  placeholder={provider === 'jina' ? 'jina_...' : 'sk-...'}
                  style={{
                    width: '100%',
                    padding: '10px',
                    paddingRight: '40px',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--color-border)',
                    background: 'var(--color-bg-primary)',
                    color: 'var(--color-text-primary)',
                    fontSize: 'var(--text-sm)',
                  }}
                />
                <button
                  type="button"
                  onClick={() => setShowApiKey(!showApiKey)}
                  style={{
                    position: 'absolute',
                    right: '8px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    padding: '4px',
                    color: 'var(--color-text-muted)',
                    display: 'flex',
                    alignItems: 'center',
                  }}
                >
                  {showApiKey ? (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                      <line x1="1" y1="1" x2="23" y2="23" />
                    </svg>
                  ) : (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                  )}
                </button>
              </div>
              <button
                onClick={handleTest}
                disabled={testing || !apiKey.trim()}
                className="btn-secondary"
                style={{
                  flexShrink: 0,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  opacity: testing || !apiKey.trim() ? 0.5 : 1,
                  cursor: testing || !apiKey.trim() ? 'not-allowed' : 'pointer',
                }}
              >
                {testing && <div className="spinner" style={{ width: '14px', height: '14px', borderWidth: '2px' }} />}
                {t('kb.test', 'Test')}
              </button>
            </div>
            {testResult && (
              <div
                className="mt-2 text-xs"
                style={{ color: testResult.success ? '#10b981' : '#ef4444' }}
              >
                {testResult.success
                  ? t('kb.testSuccess', '连接成功')
                  : testResult.message}
              </div>
            )}
          </div>

          {/* Model name */}
          <div>
            <label
              className="block mb-2 text-sm font-medium"
              style={{ color: 'var(--color-text-secondary)' }}
            >
              {t('labels.embeddingModel', 'Model Name')}
            </label>
            <input
              type="text"
              value={modelName}
              onChange={(e) => setModelName(e.target.value)}
              placeholder={PROVIDER_DEFAULT_MODELS[provider]}
              style={{
                width: '100%',
                padding: '10px',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--color-border)',
                background: 'var(--color-bg-primary)',
                color: 'var(--color-text-primary)',
                fontSize: 'var(--text-sm)',
              }}
            />
          </div>

          {/* Embedding API base URL (custom only) */}
          {provider === 'custom' && (
            <div>
              <label
                className="block mb-2 text-sm font-medium"
                style={{ color: 'var(--color-text-secondary)' }}
              >
                {t('labels.embeddingApiBase', 'Embedding API Base URL')}
              </label>
              <input
                type="text"
                value={embeddingApiBase}
                onChange={(e) => setEmbeddingApiBase(e.target.value)}
                placeholder="https://dashscope.aliyuncs.com/compatible-mode/v1"
                style={{
                  width: '100%',
                  padding: '10px',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--color-border)',
                  background: 'var(--color-bg-primary)',
                  color: 'var(--color-text-primary)',
                  fontSize: 'var(--text-sm)',
                }}
              />
            </div>
          )}

          {/* Warning */}
          <div
            className="flex items-start gap-2 p-3 rounded-md text-xs"
            style={{
              background: 'rgba(245, 158, 11, 0.08)',
              border: '1px solid rgba(245, 158, 11, 0.2)',
              color: '#f59e0b',
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="mt-0.5 flex-shrink-0">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            <span>{t('kb.cannotChangeWarning', '设置后无法更改，只能重置')}</span>
          </div>

          {/* Action buttons */}
          <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
            {onCancel && (
              <button
                onClick={onCancel}
                className="btn-secondary"
                style={{ flex: 1 }}
              >
                {t('buttons.cancel', '取消')}
              </button>
            )}
            <button
              onClick={handleSetup}
              disabled={settingUp || !apiKey.trim()}
              style={{
                flex: 1,
                padding: '12px',
                borderRadius: 'var(--radius-md)',
                border: 'none',
                background: 'var(--color-accent-primary)',
                color: 'var(--color-text-inverse)',
                fontWeight: 600,
                fontSize: 'var(--text-sm)',
                cursor: settingUp || !apiKey.trim() ? 'not-allowed' : 'pointer',
                opacity: settingUp || !apiKey.trim() ? 0.5 : 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                transition: 'opacity 0.2s',
              }}
            >
              {settingUp && <div className="spinner" style={{ width: '16px', height: '16px', borderWidth: '2px', borderColor: 'rgba(255,255,255,0.3)', borderTopColor: 'white' }} />}
              {t('kb.initKnowledgeBase', '初始化知识库')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
