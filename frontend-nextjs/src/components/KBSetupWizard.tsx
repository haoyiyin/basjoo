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

const JINA_API_KEY_URL = 'https://jina.ai/'
const SILICONFLOW_API_KEY_URL = 'https://cloud.siliconflow.cn/'

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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      {error && (
        <div style={{
          padding: 'var(--space-3) var(--space-4)',
          borderRadius: 'var(--radius-md)',
          fontSize: 'var(--text-sm)',
          background: 'var(--color-error-bg)',
          border: '1px solid var(--color-error)',
          color: 'var(--color-error)',
        }}>
          {error}
        </div>
      )}

      <div className="glass-card" style={{ padding: 'var(--space-6)' }}>
        <h3 style={{
          fontSize: 'var(--text-lg)',
          fontWeight: 600,
          marginBottom: 'var(--space-1)',
          color: 'var(--color-text-primary)',
        }}>
          {t('kb.setupTitle')}
        </h3>
        <p style={{
          fontSize: 'var(--text-sm)',
          marginBottom: 'var(--space-6)',
          color: 'var(--color-text-muted)',
        }}>
          {t('kb.setupDescription')}
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
          {/* Provider dropdown */}
          <div>
            <label style={{
              display: 'block',
              marginBottom: 'var(--space-2)',
              fontSize: 'var(--text-sm)',
              fontWeight: 500,
              color: 'var(--color-text-secondary)',
            }}>
              {t('labels.embeddingProvider')}
            </label>
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value as EmbeddingProvider)}
              style={{ paddingRight: 'var(--space-8)' }}
            >
              <option value="jina">{t('labels.embeddingProviderJina')}</option>
              <option value="siliconflow">{t('labels.embeddingProviderSiliconFlow')}</option>
              <option value="custom">{t('labels.embeddingProviderCustom')}</option>
            </select>
          </div>

          {/* API Key with auto-detect on blur */}
          <div>
            <label style={{
              display: 'block',
              marginBottom: 'var(--space-2)',
              fontSize: 'var(--text-sm)',
              fontWeight: 500,
              color: 'var(--color-text-secondary)',
            }}>
              {t('kb.apiKey')}
            </label>
            <div style={{ position: 'relative' }}>
              <input
                type={showApiKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => {
                  setApiKey(e.target.value)
                  setTestResult(null)
                }}
                onBlur={() => {
                  if (apiKey.trim() && !testing) {
                    handleTest()
                  }
                }}
                placeholder={provider === 'jina' ? 'jina_...' : 'sk-...'}
                style={{ paddingRight: '40px' }}
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
            {testResult && (
              <div style={{
                marginTop: 'var(--space-2)',
                fontSize: 'var(--text-xs)',
                color: testResult.success ? 'var(--color-success)' : 'var(--color-error)',
              }}>
                {testResult.success
                  ? t('kb.testSuccess')
                  : testResult.message}
              </div>
            )}
            {provider !== 'custom' && (
              <div style={{ marginTop: 'var(--space-2)', fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)' }}>
                {t('labels.embeddingGetKey')}{' '}
                <a
                  href={provider === 'jina' ? JINA_API_KEY_URL : SILICONFLOW_API_KEY_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: 'var(--color-primary)', textDecoration: 'underline' }}
                >
                  {provider === 'jina' ? 'Jina' : 'SiliconFlow'}
                </a>
              </div>
            )}
          </div>

          {/* Model name */}
          <div>
            <label style={{
              display: 'block',
              marginBottom: 'var(--space-2)',
              fontSize: 'var(--text-sm)',
              fontWeight: 500,
              color: 'var(--color-text-secondary)',
            }}>
              {t('kb.modelName')}
            </label>
            <input
              type="text"
              value={modelName}
              onChange={(e) => setModelName(e.target.value)}
              placeholder={PROVIDER_DEFAULT_MODELS[provider]}
            />
          </div>

          {/* Embedding API base URL (custom only) */}
          {provider === 'custom' && (
            <div>
              <label style={{
                display: 'block',
                marginBottom: 'var(--space-2)',
                fontSize: 'var(--text-sm)',
                fontWeight: 500,
                color: 'var(--color-text-secondary)',
              }}>
                {t('labels.embeddingApiBase')}
              </label>
              <input
                type="text"
                value={embeddingApiBase}
                onChange={(e) => setEmbeddingApiBase(e.target.value)}
                placeholder="https://dashscope.aliyuncs.com/compatible-mode/v1"
              />
            </div>
          )}

          {/* Warning */}
          <div style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 'var(--space-2)',
            padding: 'var(--space-3) var(--space-4)',
            borderRadius: 'var(--radius-md)',
            fontSize: 'var(--text-xs)',
            background: 'var(--color-warning-bg)',
            border: '1px solid var(--color-warning)',
            color: 'var(--color-warning)',
          }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginTop: '2px', flexShrink: 0 }}>
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            <span>{t('kb.warning')}</span>
          </div>

          {/* Action buttons */}
          <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
            {onCancel && (
              <button
                onClick={onCancel}
                className="btn-secondary"
                style={{ flex: 1 }}
              >
                {t('buttons.cancel')}
              </button>
            )}
            <button
              onClick={handleSetup}
              disabled={settingUp || !apiKey.trim()}
              className="btn-primary"
              style={{ flex: 1 }}
            >
              {settingUp && <div className="spinner" style={{ width: '16px', height: '16px', borderWidth: '2px', borderColor: 'rgba(255,255,255,0.3)', borderTopColor: 'white' }} />}
              {t('kb.initButton')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
