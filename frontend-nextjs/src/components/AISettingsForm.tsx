'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import HelpTooltip from './HelpTooltip'
import { api } from '../services/api'
import type { Agent, ProviderType } from '../services/api'

type PersonaType = 'general' | 'customer-service' | 'sales' | 'custom';
type ApiFormatType = 'openai' | 'openai_compatible' | 'anthropic' | 'google';
type ReasoningEffortSetting = 'off' | 'low' | 'medium' | 'high';

const PERSONA_TYPES: PersonaType[] = ['general', 'customer-service', 'sales', 'custom'];

interface ChatParamOverrides {
  temperature: number;
  max_tokens: number;
  reasoning_effort: 'low' | 'medium' | 'high' | null;
}

interface AISettingsFormProps {
  compact?: boolean;
  highlightJinaKey?: boolean;
  refreshSignal?: number;
  onSave?: (updatedAgent?: Agent) => void;
  onChatParamsChange?: (params: ChatParamOverrides) => void;
  onSaveBusyChange?: (busy: boolean) => void;
}

export default function AISettingsForm({ compact = false, highlightJinaKey = false, refreshSignal, onSave, onChatParamsChange, onSaveBusyChange }: AISettingsFormProps) {
  const { t } = useTranslation('common')
  const [agent, setAgent] = useState<Agent | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [apiKeyError, setApiKeyError] = useState(false)
  const [jinaKeyError, setJinaKeyError] = useState(false)
  const [selectedPersona, setSelectedPersona] = useState<PersonaType>('custom')
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const suppressAutoSaveRef = useRef(true)

  const [formData, setFormData] = useState({
    name: '',
    system_prompt: '',
    model: '',
    temperature: 0.7,
    max_tokens: 1024,
    reasoning_effort: 'off' as ReasoningEffortSetting,
    api_key: '',
    api_base: '',
    jina_api_key: '',
    provider_type: 'openai' as ProviderType,
    api_format: 'openai' as ApiFormatType,
    top_k: 5,
    similarity_threshold: 0.5,
    enable_context: false,
    rate_limit_per_hour: 100,
    restricted_reply: '',
  })
  const [personaError, setPersonaError] = useState(false)

  useEffect(() => {
    fetchAgent()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshSignal])

  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current)
      }
    }
  }, [])

  useEffect(() => {
    onChatParamsChange?.({
      temperature: formData.temperature,
      max_tokens: formData.max_tokens,
      reasoning_effort: formData.reasoning_effort === 'off' ? null : formData.reasoning_effort,
    })
  }, [formData.temperature, formData.max_tokens, formData.reasoning_effort, onChatParamsChange])

  useEffect(() => {
    onSaveBusyChange?.(saving)
  }, [saving, onSaveBusyChange])

  const fetchAgent = async () => {
    try {
      setLoading(true)
      setError(null)
      const agentData = await api.getDefaultAgent()
      suppressAutoSaveRef.current = true
      setAgent(agentData)

      const personaType = agentData.persona_type as PersonaType || 'custom'
      setSelectedPersona(personaType)

      setFormData({
        name: agentData.name || '',
        system_prompt: agentData.system_prompt || '',
        model: agentData.model || 'deepseek-chat',
        temperature: agentData.temperature ?? 0.7,
        max_tokens: agentData.max_tokens ?? 1024,
        reasoning_effort: agentData.reasoning_effort ?? 'off',
        api_key: '',
        api_base: agentData.api_base || 'https://api.deepseek.com/v1',
        jina_api_key: '',
        provider_type: agentData.provider_type || 'openai',
        api_format: (agentData.api_format as ApiFormatType) || 'openai',
        top_k: agentData.top_k ?? 5,
        similarity_threshold: agentData.similarity_threshold ?? 0.5,
        enable_context: agentData.enable_context ?? false,
        rate_limit_per_hour: agentData.rate_limit_per_hour ?? 100,
        restricted_reply: agentData.restricted_reply ?? t('labels.restrictedReplyPlaceholder'),
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errors.loadFailed'))
    } finally {
      setLoading(false)
    }
  }

  const handlePersonaChange = (newPersona: PersonaType) => {
    setSelectedPersona(newPersona)
    if (newPersona === 'custom' && selectedPersona !== 'custom') {
      setFormData({
        ...formData,
        system_prompt: ''
      })
    }
  }

  const handlePromptChange = (value: string) => {
    setFormData({ ...formData, system_prompt: value })
  }

  // 清除 AI API Key
  const handleClearAIKey = async () => {
    if (!agent) return
    if (!confirm(t('labels.confirmClearAIKey'))) return

    setSaving(true)
    try {
      const updatedAgent = await api.updateAgent(agent.id, { api_key: '' })
      suppressAutoSaveRef.current = true
      setFormData({ ...formData, api_key: '' })
      setAgent(updatedAgent)
      onSave?.(updatedAgent)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errors.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  // 清除 Jina API Key
  const handleClearJinaKey = async () => {
    if (!agent) return
    if (!confirm(t('labels.confirmClearJinaKey'))) return

    setSaving(true)
    try {
      const updatedAgent = await api.updateAgent(agent.id, { jina_api_key: '' })
      suppressAutoSaveRef.current = true
      setFormData({ ...formData, jina_api_key: '' })
      setAgent(updatedAgent)
      onSave?.(updatedAgent)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errors.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  const handleSave = useCallback(async () => {
    if (!agent) return

    if (selectedPersona === 'custom' && !formData.system_prompt.trim()) {
      setPersonaError(true)
      return
    }

    setSaving(true)
    setError(null)
    setApiKeyError(false)
    setJinaKeyError(false)

    let aiKeyTestFailed = false
    let jinaKeyTestFailed = false

    try {
      const updateData: Partial<Agent> = {
        name: formData.name,
        system_prompt: formData.system_prompt,
        model: formData.model,
        temperature: formData.temperature,
        max_tokens: formData.max_tokens,
        reasoning_effort: formData.reasoning_effort === 'off' ? null : formData.reasoning_effort,
        api_base: formData.api_base,
        provider_type: formData.provider_type,
        api_format: formData.api_format,
        top_k: formData.top_k,
        similarity_threshold: formData.similarity_threshold,
        enable_context: formData.enable_context,
        rate_limit_per_hour: formData.rate_limit_per_hour,
        restricted_reply: formData.restricted_reply,
        persona_type: selectedPersona,
      }

      if (formData.api_key.trim()) {
        updateData.api_key = formData.api_key
      }

      if (formData.jina_api_key.trim()) {
        updateData.jina_api_key = formData.jina_api_key
      }

      if (formData.api_key.trim()) {
        const aiTestResult = await api.testAIApi(agent.id, updateData)
        if (!aiTestResult.success) {
          aiKeyTestFailed = true
          throw new Error(t('errors.aiApiTestFailed'))
        }
      }

      if (formData.jina_api_key.trim()) {
        const jinaTestResult = await api.testJinaApi(agent.id, updateData)
        if (!jinaTestResult.success) {
          jinaKeyTestFailed = true
          throw new Error(t('errors.jinaApiTestFailed'))
        }
      }

      const updatedAgent = await api.updateAgent(agent.id, updateData)
      suppressAutoSaveRef.current = true
      setAgent(updatedAgent)
      setFormData(prev => ({
        ...prev,
        api_key: '',
        jina_api_key: '',
        reasoning_effort: updatedAgent.reasoning_effort ?? 'off',
      }))
      onSave?.(updatedAgent)
    } catch (err) {
      let errorMessage: string
      if (err instanceof Error) {
        errorMessage = err.message
      } else if (typeof err === 'object' && err !== null) {
        const errObj = err as Record<string, unknown>
        if (typeof errObj.message === 'string') {
          errorMessage = errObj.message
        } else if (typeof errObj.detail === 'string') {
          errorMessage = errObj.detail
        } else if (typeof errObj.message === 'object' && errObj.message !== null) {
          errorMessage = JSON.stringify(errObj.message)
        } else {
          errorMessage = String(err) || t('errors.saveFailed')
        }
      } else {
        errorMessage = String(err) || t('errors.saveFailed')
      }
      if (aiKeyTestFailed) {
        setApiKeyError(true)
      }
      if (jinaKeyTestFailed) {
        setJinaKeyError(true)
      }
      setError(errorMessage)
    } finally {
      setSaving(false)
    }
  }, [agent, formData, onSave, selectedPersona, t])

  useEffect(() => {
    if (loading || !agent) {
      return
    }

    if (suppressAutoSaveRef.current) {
      suppressAutoSaveRef.current = false
      return
    }

    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current)
    }

    saveTimeoutRef.current = setTimeout(() => {
      void handleSave()
    }, 800)

    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current)
      }
    }
  }, [
    agent,
    loading,
    selectedPersona,
    formData.name,
    formData.system_prompt,
    formData.model,
    formData.temperature,
    formData.max_tokens,
    formData.reasoning_effort,
    formData.api_base,
    formData.provider_type,
    formData.api_format,
    formData.top_k,
    formData.similarity_threshold,
    formData.enable_context,
    formData.rate_limit_per_hour,
    formData.restricted_reply,
    formData.api_key,
    formData.jina_api_key,
    handleSave,
  ])

  // 默认 API Base URL
  const getDefaultApiBase = (provider: ProviderType): string => {
    switch (provider) {
      case 'openai_native':
        return 'https://api.openai.com/v1'
      case 'google':
        return 'https://generativelanguage.googleapis.com/v1beta'
      case 'anthropic':
        return 'https://api.anthropic.com/v1'
      case 'xai':
        return 'https://api.x.ai/v1'
      case 'openrouter':
        return 'https://openrouter.ai/api/v1'
      case 'zai':
        return 'https://api.z.ai/v1'
      case 'deepseek':
        return 'https://api.deepseek.com/v1'
      case 'volcengine':
        return 'https://ark.cn-beijing.volces.com/api/v3'
      case 'moonshot':
        return 'https://api.moonshot.cn/v1'
      case 'aliyun_bailian':
        return 'https://dashscope.aliyuncs.com/compatible-mode/v1'
      case 'openai':
      default:
        return 'https://api.openai.com/v1'
    }
  }

  // 默认模型名称
  const getDefaultModel = (provider: ProviderType): string => {
    switch (provider) {
      case 'openai_native':
        return 'gpt-4o'
      case 'google':
        return 'gemini-pro'
      case 'anthropic':
        return 'claude-3-5-sonnet-20241022'
      case 'xai':
        return 'grok-2-latest'
      case 'openrouter':
        return 'openai/gpt-4o'
      case 'zai':
        return 'z1-preview'
      case 'deepseek':
        return 'deepseek-chat'
      case 'volcengine':
        return 'doubao-pro-32k'
      case 'moonshot':
        return 'moonshot-v1-8k'
      case 'aliyun_bailian':
        return 'qwen-plus'
      case 'openai':
      default:
        return 'gpt-4o'
    }
  }

  // 切换provider时设置默认值
  const handleProviderChange = (provider: ProviderType) => {
    setFormData(prev => ({
      ...prev,
      provider_type: provider,
      api_base: getDefaultApiBase(provider),
      model: getDefaultModel(provider),
    }))
  }

  if (loading) {
    return (
      <div style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        height: '200px',
      }}>
        <div className="spinner" />
      </div>
    )
  }

  return (
    <div style={{
      padding: compact ? 'var(--space-4)' : 'var(--space-6)',
      overflow: 'auto',
      height: '100%',
    }}>
      {error && (
        <div style={{
          padding: 'var(--space-3)',
          marginBottom: 'var(--space-4)',
          background: 'rgba(239, 68, 68, 0.1)',
          border: '1px solid rgba(239, 68, 68, 0.3)',
          borderRadius: 'var(--radius-md)',
          color: '#ef4444',
          fontSize: 'var(--text-sm)',
        }}>
          {error}
        </div>
      )}

      {!agent?.api_key_set && (
        <div style={{
          padding: 'var(--space-3)',
          marginBottom: 'var(--space-4)',
          background: 'rgba(245, 158, 11, 0.1)',
          border: '1px solid rgba(245, 158, 11, 0.3)',
          borderRadius: 'var(--radius-md)',
          color: '#f59e0b',
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-2)',
          fontSize: 'var(--text-sm)',
        }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          <span>{t('labels.pleaseConfigureApiKey')}</span>
        </div>
      )}

      <div style={{
        display: 'flex',
        flexDirection: 'column',
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
            {t('labels.agentName')}
          </label>
          <input
            type="text"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            placeholder={t('labels.aiAssistant')}
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
            {t('labels.presetPersona')}
            <HelpTooltip
              title={t('labels.presetPersona')}
              content={[
                t('labels.presetPersonaDesc'),
                t('labels.genericPersona'),
                t('labels.customerServicePersona'),
                t('labels.salesPersona'),
                t('labels.customPersona')
              ]}
              position="top"
              size="xs"
            />
          </label>
          <select
            value={selectedPersona}
            onChange={(e) => handlePersonaChange(e.target.value as PersonaType)}
            style={{
              width: '100%',
              padding: 'var(--space-3)',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--color-border)',
              background: 'var(--color-bg-primary)',
              color: 'var(--color-text-primary)',
              fontSize: 'var(--text-sm)',
              cursor: 'pointer',
            }}
          >
            {PERSONA_TYPES.map((key) => (
              <option key={key} value={key}>
                {key === 'general' ? t('personas.generic.name') :
                 key === 'customer-service' ? t('personas.customerService.name') :
                 key === 'sales' ? t('personas.sales.name') :
                 t('personas.custom.name')}
              </option>
            ))}
          </select>
          {selectedPersona === 'custom' && (
            <>
              <textarea
                value={formData.system_prompt}
                onChange={(e) => {
                  handlePromptChange(e.target.value)
                  // 清除错误状态当用户开始输入
                  if (e.target.value.trim()) {
                    setPersonaError(false)
                  }
                }}
                rows={compact ? 4 : 6}
                placeholder={t('placeholders.enterCustomPersona')}
                style={{
                  marginTop: 'var(--space-2)',
                  resize: 'vertical',
                  fontFamily: 'monospace',
                  border: personaError ? '2px solid var(--color-error)' : '1px solid var(--color-border)',
                  background: personaError ? 'rgba(239, 68, 68, 0.05)' : undefined,
                }}
              />
              {personaError && (
                <div style={{
                  color: 'var(--color-error)',
                  fontSize: 'var(--text-sm)',
                  marginTop: 'var(--space-1)',
                }}>
                  {t('errors.customPersonaRequired')}
                </div>
              )}
            </>
          )}
        </div>

        <div>
          <label style={{
            display: 'block',
            marginBottom: 'var(--space-2)',
            fontSize: 'var(--text-sm)',
            fontWeight: 500,
            color: 'var(--color-text-secondary)',
          }}>
            {t('labels.aiProvider')}
          </label>
          <select
            value={formData.provider_type}
            onChange={(e) => handleProviderChange(e.target.value as ProviderType)}
            style={{
              width: '100%',
              padding: 'var(--space-3)',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--color-border)',
              background: 'var(--color-bg-primary)',
              color: 'var(--color-text-primary)',
              fontSize: 'var(--text-sm)',
              cursor: 'pointer',
            }}
          >
            <option value="openai_native">OpenAI (ChatGPT)</option>
            <option value="anthropic">Anthropic (Claude)</option>
            <option value="google">Google (Gemini)</option>
            <option value="xai">xAI (Grok)</option>
            <option value="deepseek">DeepSeek</option>
            <option value="openrouter">OpenRouter</option>
            <option value="zai">z.ai</option>
            <option value="volcengine">{t('labels.volcengine')}</option>
            <option value="moonshot">{t('labels.moonshot')}</option>
            <option value="aliyun_bailian">{t('labels.aliyun_bailian')}</option>
            <option value="openai">{t('labels.openaiCompatible')}</option>
          </select>
        </div>

        {/* API格式选择 - 仅在自定义模式下显示 */}
        {formData.provider_type === 'openai' && (
          <div>
            <label style={{
              display: 'block',
              marginBottom: 'var(--space-2)',
              fontSize: 'var(--text-sm)',
              fontWeight: 500,
              color: 'var(--color-text-secondary)',
            }}>
              {t('labels.apiFormat')}
            </label>
            <select
              value={formData.api_format}
              onChange={(e) => setFormData({ ...formData, api_format: e.target.value as ApiFormatType })}
              style={{
                width: '100%',
                padding: 'var(--space-3)',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--color-border)',
                background: 'var(--color-bg-primary)',
                color: 'var(--color-text-primary)',
                fontSize: 'var(--text-sm)',
                cursor: 'pointer',
              }}
            >
              <option value="openai">OpenAI</option>
              <option value="openai_compatible">OpenAI Compatible</option>
              <option value="anthropic">Anthropic</option>
              <option value="google">Google (Gemini)</option>
            </select>
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' }}>
          <div>
            <label style={{
              display: 'block',
              marginBottom: 'var(--space-2)',
              fontSize: 'var(--text-sm)',
              fontWeight: 500,
              color: 'var(--color-text-secondary)',
            }}>
              {t('labels.temperature')} ({formData.temperature})
            </label>
            <input
              type="range"
              min="0"
              max="2"
              step="0.1"
              value={formData.temperature}
              onChange={(e) => setFormData({ ...formData, temperature: parseFloat(e.target.value) })}
              style={{ width: '100%' }}
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
              {t('labels.maxTokens')} ({formData.max_tokens})
            </label>
            <input
              type="range"
              min="256"
              max="4096"
              step="256"
              value={formData.max_tokens}
              onChange={(e) => setFormData({ ...formData, max_tokens: parseInt(e.target.value, 10) })}
              style={{ width: '100%' }}
            />
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
            {t('labels.reasoningEffort')}
          </label>
          <select
            value={formData.reasoning_effort}
            onChange={(e) => setFormData({ ...formData, reasoning_effort: e.target.value as ReasoningEffortSetting })}
            style={{
              width: '100%',
              maxWidth: compact ? '100%' : '50%',
              padding: 'var(--space-3)',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--color-border)',
              background: 'var(--color-bg-primary)',
              color: 'var(--color-text-primary)',
              fontSize: 'var(--text-sm)',
              cursor: 'pointer',
            }}
          >
            <option value="off">{t('labels.reasoningEffortOff')}</option>
            <option value="low">{t('labels.reasoningEffortLow')}</option>
            <option value="medium">{t('labels.reasoningEffortMedium')}</option>
            <option value="high">{t('labels.reasoningEffortHigh')}</option>
          </select>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' }}>
          <div>
            <label style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 'var(--space-2)',
              fontSize: 'var(--text-sm)',
              fontWeight: 500,
              color: 'var(--color-text-secondary)',
            }}>
              <span>
                {t('labels.apiKey')}
                {agent?.api_key_set && (
                  <span style={{
                    marginLeft: 'var(--space-2)',
                    color: 'var(--color-success)',
                    fontSize: 'var(--text-xs)',
                  }}>
                    ✓ {t('labels.configured')}
                  </span>
                )}
              </span>
              {agent?.api_key_set && (
                <button
                  onClick={handleClearAIKey}
                  disabled={saving}
                  style={{
                    fontSize: 'var(--text-xs)',
                    color: 'var(--color-error)',
                    background: 'transparent',
                    border: 'none',
                    cursor: saving ? 'not-allowed' : 'pointer',
                    opacity: saving ? 0.5 : 1,
                    padding: '0',
                    textDecoration: 'underline',
                  }}
                >
                  {t('buttons.clear')}
                </button>
              )}
            </label>
            <input
              type="password"
              value={formData.api_key}
              onChange={(e) => {
                setFormData({ ...formData, api_key: e.target.value })
                setApiKeyError(false)
              }}
              placeholder={agent?.api_key_set ? t('placeholders.enterNewApiKey') : "sk-..."}
              style={apiKeyError ? { border: '2px solid #ef4444' } : undefined}
            />
            {apiKeyError && (
              <div style={{
                marginTop: 'var(--space-2)',
                color: '#ef4444',
                fontSize: 'var(--text-xs)',
              }}>
                {t('errors.aiApiKeyInvalid')}
              </div>
            )}
          </div>

          {/* API Base: 所有服务商都显示 */}
          <div>
            <label style={{
              display: 'block',
              marginBottom: 'var(--space-2)',
              fontSize: 'var(--text-sm)',
              fontWeight: 500,
              color: 'var(--color-text-secondary)',
            }}>
              {t('labels.apiBase')}
            </label>
            <input
              type="text"
              value={formData.api_base}
              onChange={(e) => setFormData({ ...formData, api_base: e.target.value })}
              placeholder={getDefaultApiBase(formData.provider_type)}
            />
          </div>
        </div>

        {/* 模型名称单独一行 */}
        <div>
          <label style={{
            display: 'block',
            marginBottom: 'var(--space-2)',
            fontSize: 'var(--text-sm)',
            fontWeight: 500,
            color: 'var(--color-text-secondary)',
          }}>
            {t('labels.modelName')}
          </label>
          <input
            type="text"
            value={formData.model}
            onChange={(e) => setFormData({ ...formData, model: e.target.value })}
            placeholder={getDefaultModel(formData.provider_type)}
          />
        </div>

        {/* Jina API与相似度并排 */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' }}>
          <div>
            <label style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 'var(--space-2)',
              fontSize: 'var(--text-sm)',
              fontWeight: 500,
              color: 'var(--color-text-secondary)',
            }}>
              <span>
                {t('labels.jinaEmbeddingApiKey')}
                {agent?.jina_api_key_set && (
                  <span style={{
                    marginLeft: 'var(--space-2)',
                    color: 'var(--color-success)',
                    fontSize: 'var(--text-xs)',
                  }}>
                    ✓ {t('labels.configured')}
                  </span>
                )}
              </span>
              {agent?.jina_api_key_set && (
                <button
                  onClick={handleClearJinaKey}
                  disabled={saving}
                  style={{
                    fontSize: 'var(--text-xs)',
                    color: 'var(--color-error)',
                    background: 'transparent',
                    border: 'none',
                    cursor: saving ? 'not-allowed' : 'pointer',
                    opacity: saving ? 0.5 : 1,
                    padding: '0',
                    textDecoration: 'underline',
                  }}
                >
                  {t('buttons.clear')}
                </button>
              )}
            </label>
            <input
              type="password"
              value={formData.jina_api_key}
              onChange={(e) => {
                setFormData({ ...formData, jina_api_key: e.target.value })
                setJinaKeyError(false)
              }}
              placeholder={agent?.jina_api_key_set ? t('placeholders.enterJinaKey') : "jina_..."}
              style={(highlightJinaKey || jinaKeyError) ? { border: '2px solid #ef4444' } : undefined}
            />
            {(highlightJinaKey || jinaKeyError) && (
              <div style={{
                marginTop: 'var(--space-2)',
                color: '#ef4444',
                fontSize: 'var(--text-xs)',
              }}>
                {jinaKeyError ? t('errors.jinaApiKeyInvalid') : t('labels.jinaKeyRequired')}
              </div>
            )}
          </div>

          <div>
            <label style={{
              display: 'block',
              marginBottom: 'var(--space-2)',
              fontSize: 'var(--text-sm)',
              fontWeight: 500,
              color: 'var(--color-text-secondary)',
            }}>
              {t('labels.similarityThreshold')} ({formData.similarity_threshold})
            </label>
            <input
              type="range"
              min="0"
              max="1"
              step="0.1"
              value={formData.similarity_threshold}
              onChange={(e) => setFormData({ ...formData, similarity_threshold: parseFloat(e.target.value) })}
              style={{ width: '100%' }}
            />
          </div>
        </div>

        <div style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-3)',
        }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: 'var(--space-3)',
            background: 'var(--color-bg-tertiary)',
            borderRadius: 'var(--radius-md)',
          }}>
            <div>
              <div style={{
                fontSize: 'var(--text-sm)',
                fontWeight: 500,
                color: 'var(--color-text-primary)',
              }}>
                {t('labels.enableContext')}
              </div>
              <div style={{
                fontSize: 'var(--text-xs)',
                color: 'var(--color-text-muted)',
              }}>
                {t('labels.conversationContextShort')}
              </div>
            </div>
            <button
              onClick={() => setFormData({ ...formData, enable_context: !formData.enable_context })}
              style={{
                width: '44px',
                height: '24px',
                borderRadius: '12px',
                border: 'none',
                background: formData.enable_context ? 'var(--color-accent-primary)' : 'var(--color-bg-secondary)',
                cursor: 'pointer',
                position: 'relative',
                transition: 'background 0.2s',
              }}
            >
              <span style={{
                position: 'absolute',
                top: '2px',
                left: formData.enable_context ? '22px' : '2px',
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
      </div>
    </div>
  )
}
