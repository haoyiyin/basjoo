'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { api } from '../services/api'
import type { Agent as ApiAgent, ChatRequest, Source, StreamDoneMeta, UsageInfo } from '../services/api';
import AdminLayout from '../components/AdminLayout';
import AISettingsForm from '../components/AISettingsForm';
import ChatPanel from '../components/ChatPanel';
import type { Message as ChatPanelMessage, Agent as ChatPanelAgent } from '../components/ChatPanel';
import { useIsMobile } from '../hooks/useMediaQuery';

interface ChatParamOverrides {
  temperature: number;
  max_tokens: number;
  reasoning_effort: 'low' | 'medium' | 'high' | null;
}

type TabType = 'settings' | 'preview';

export default function Playground() {
  const { t, i18n } = useTranslation('common');
  const isMobile = useIsMobile();
  const [agentId, setAgentId] = useState<string | null>(null);
  const [agent, setAgent] = useState<ChatPanelAgent | null>(null);
  const [messages, setMessages] = useState<ChatPanelMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [sessionId, setSessionId] = useState<string | undefined>();
  const [activeTab, setActiveTab] = useState<TabType>('preview');
  const [searchParams] = useSearchParams();
  const highlightJinaKey = searchParams?.get('highlightJinaKey') === 'true';
  const [showSaved, setShowSaved] = useState(false);
  const [isSettingsSaving, setIsSettingsSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [chatParams, setChatParams] = useState<ChatParamOverrides>({
    temperature: 0.7,
    max_tokens: 1024,
    reasoning_effort: null,
  });
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const streamingMessageClientIdRef = useRef<number | null>(null);
  const nextMessageClientIdRef = useRef(0);
  const streamAbortControllerRef = useRef<AbortController | null>(null);
  const streamRequestIdRef = useRef(0);

  useEffect(() => {
    loadDefaultAgent();
  }, []);

  const loadDefaultAgent = async () => {
    try {
      const data = await api.getDefaultAgent();
      setAgent(data);
      setAgentId(data.id);
      setChatParams({
        temperature: data.temperature,
        max_tokens: data.max_tokens,
        reasoning_effort: data.reasoning_effort ?? null,
      });
    } catch (error) {
      console.error('Failed to load default agent:', error);
    }
  };

  const getErrorMessage = useCallback((error: unknown): string => {
    if (!(error instanceof Error)) {
      return t('errors.unknown');
    }

    const errorMessage = error.message.toLowerCase();

    // AI API errors
    if (errorMessage.includes('api key') || errorMessage.includes('401') || errorMessage.includes('unauthorized')) {
      if (errorMessage.includes('jina')) {
        return t('errors.jinaApiKeyInvalid');
      }
      return t('errors.aiApiKeyInvalid');
    }

    if (errorMessage.includes('timeout') || errorMessage.includes('etimedout')) {
      if (errorMessage.includes('jina')) {
        return t('errors.jinaApiTimeout');
      }
      return t('errors.aiApiTimeout');
    }

    if (errorMessage.includes('rate limit') || errorMessage.includes('429')) {
      if (errorMessage.includes('jina')) {
        return t('errors.jinaApiRateLimit');
      }
      return t('errors.aiApiRateLimit');
    }

    if (errorMessage.includes('quota') || errorMessage.includes('insufficient') || errorMessage.includes('billing')) {
      return t('errors.aiApiInsufficientQuota');
    }

    if (errorMessage.includes('model') && (errorMessage.includes('not found') || errorMessage.includes('does not exist'))) {
      return t('errors.aiApiModelNotFound');
    }

    // Jina specific errors
    if (errorMessage.includes('jina') || errorMessage.includes('embedding')) {
      return t('errors.jinaApiError');
    }

    // Rate limit from our backend
    if (errorMessage.includes('rate_limit_exceeded') || errorMessage.includes('conversation limit')) {
      return t('errors.rateLimitExceeded');
    }

    // Daily quota
    if (errorMessage.includes('quota exceeded') || errorMessage.includes('daily')) {
      return t('errors.dailyQuotaExceeded');
    }

    // No API key configured
    if (errorMessage.includes('no api key') || errorMessage.includes('not configured')) {
      return t('errors.noApiKeyConfigured');
    }

    // Network errors
    if (errorMessage.includes('network') || errorMessage.includes('fetch') || errorMessage.includes('connection')) {
      return t('errors.networkError');
    }

    return t('errors.aiApiError');
  }, [t]);

  const handleSendMessage = useCallback(async () => {
    if (!input.trim() || isLoading || isSettingsSaving || !agentId) return;

    streamAbortControllerRef.current?.abort();
    const abortController = new AbortController();
    streamAbortControllerRef.current = abortController;
    const requestId = ++streamRequestIdRef.current;

    const currentInput = input;
    const userMessageClientId = ++nextMessageClientIdRef.current;
    const streamingMessageClientId = ++nextMessageClientIdRef.current;

    const userMessage: ChatPanelMessage = {
      clientId: userMessageClientId,
      role: 'user',
      content: currentInput,
      timestamp: new Date(),
    };

    const streamingMessage: ChatPanelMessage = {
      clientId: streamingMessageClientId,
      role: 'assistant',
      content: '',
      sources: [],
      isStreaming: true,
      timestamp: new Date(),
    };

    let streamSources: Source[] = [];

    const isStaleRequest = () => requestId !== streamRequestIdRef.current;

    const updateStreamingMessage = (updater: (message: ChatPanelMessage) => ChatPanelMessage) => {
      if (isStaleRequest()) {
        return;
      }

      setMessages(prev => {
        const index = prev.findIndex(message => message.clientId === streamingMessageClientId);
        if (index === -1) {
          return prev;
        }

        const next = [...prev];
        next[index] = updater(next[index]);
        return next;
      });
    };

    const finalizeStreamingMessage = (meta?: StreamDoneMeta, usage?: UsageInfo | null) => {
      if (isStaleRequest()) {
        return;
      }

      if (meta?.session_id) {
        setSessionId(meta.session_id);
      }

      if (meta?.taken_over) {
        setMessages(prev => prev.filter(message => message.clientId !== streamingMessageClientId));
        streamingMessageClientIdRef.current = null;
        return;
      }

      setMessages(prev => {
        const index = prev.findIndex(message => message.clientId === streamingMessageClientId);
        if (index === -1) {
          return prev;
        }

        const next = [...prev];
        next[index] = {
          ...next[index],
          sources: streamSources,
          usage: usage ?? meta?.usage ?? undefined,
          isStreaming: false,
        };
        return next;
      });

      streamingMessageClientIdRef.current = null;
    };

    streamingMessageClientIdRef.current = streamingMessageClientId;
    setMessages(prev => [...prev, userMessage, streamingMessage]);
    setInput('');
    setIsLoading(true);

    try {
      const request: ChatRequest = {
        agent_id: agentId,
        message: currentInput,
        locale: i18n.language,
        session_id: sessionId,
        params: {
          temperature: chatParams.temperature,
          max_tokens: chatParams.max_tokens,
          reasoning_effort: chatParams.reasoning_effort,
        },
      };

      await api.streamChat(request, {
        onSources: (sources) => {
          if (isStaleRequest()) {
            return;
          }
          streamSources = sources;
          updateStreamingMessage(message => ({
            ...message,
            sources,
          }));
        },
        onContent: (chunk) => {
          if (isStaleRequest()) {
            return;
          }
          updateStreamingMessage(message => ({
            ...message,
            content: message.content + chunk,
          }));
        },
        onDone: (meta) => {
          finalizeStreamingMessage(meta);
        },
        onError: (error) => {
          throw new Error(error);
        },
      }, {
        signal: abortController.signal,
      });
    } catch (error) {
      if (abortController.signal.aborted || isStaleRequest()) {
        return;
      }

      const fallbackError = getErrorMessage(error);
      setMessages(prev => prev.filter(message => message.clientId !== streamingMessageClientId));
      streamingMessageClientIdRef.current = null;
      const errorMessage: ChatPanelMessage = {
        role: 'assistant',
        content: fallbackError,
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      if (streamAbortControllerRef.current === abortController) {
        streamAbortControllerRef.current = null;
      }
      if (!isStaleRequest()) {
        setIsLoading(false);
      }
    }
  }, [input, isLoading, isSettingsSaving, agentId, chatParams, sessionId, i18n.language, getErrorMessage]);

  const handleClearChat = useCallback(() => {
    if (confirm(t('playground.confirmClear'))) {
      streamAbortControllerRef.current?.abort();
      streamAbortControllerRef.current = null;
      streamRequestIdRef.current += 1;
      streamingMessageClientIdRef.current = null;
      setIsLoading(false);
      setMessages([]);
      setSessionId(undefined);
    }
  }, [t]);

  const handleInputChange = useCallback((value: string) => {
    setInput(value);
  }, []);

  const handleSettingsSave = useCallback((updatedAgent?: ApiAgent) => {
    if (updatedAgent) {
      setAgent(updatedAgent);
      setAgentId(updatedAgent.id);
      setChatParams({
        temperature: updatedAgent.temperature,
        max_tokens: updatedAgent.max_tokens,
        reasoning_effort: updatedAgent.reasoning_effort ?? null,
      });
    }

    setSaveStatus('saved');
    setShowSaved(true);
    if (savedTimerRef.current) {
      clearTimeout(savedTimerRef.current);
    }
    savedTimerRef.current = setTimeout(() => {
      setShowSaved(false);
      setSaveStatus('idle');
    }, 2000);
  }, []);

  const handleSaveBusyChange = useCallback((busy: boolean) => {
    setIsSettingsSaving(busy);
    if (busy) {
      setSaveStatus('saving');
    } else if (saveStatus === 'saving') {
      // Saving finished, status will be set to 'saved' by handleSettingsSave
    }
  }, [saveStatus]);

  useEffect(() => {
    return () => {
      streamAbortControllerRef.current?.abort();
      streamAbortControllerRef.current = null;
      streamRequestIdRef.current += 1;
      if (savedTimerRef.current) {
        clearTimeout(savedTimerRef.current);
      }
    };
  }, []);

  if (isMobile) {
    return (
      <AdminLayout>
        <div style={{
          height: '100vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}>
          <div style={{
            display: 'flex',
            gap: 'var(--space-2)',
            padding: 'var(--space-2) var(--space-3)',
            background: 'var(--color-bg-primary)',
            flexShrink: 0,
          }}>
            {(['settings', 'preview'] as TabType[]).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                style={{
                  padding: 'var(--space-1) var(--space-3)',
                  border: 'none',
                  background: activeTab === tab ? 'var(--color-accent-primary)' : 'var(--color-bg-tertiary)',
                  color: activeTab === tab ? 'var(--color-text-inverse)' : 'var(--color-text-secondary)',
                  fontWeight: 500,
                  cursor: 'pointer',
                  borderRadius: 'var(--radius-full)',
                  fontSize: 'var(--text-xs)',
                  transition: 'all var(--transition-fast)',
                }}
              >
                {tab === 'settings' ? t('navigation.aiSettings') : t('playground.preview')}
              </button>
            ))}
          </div>

          <div style={{ flex: 1, overflow: 'hidden' }}>
            {activeTab === 'settings' ? (
              <div style={{ height: '100%', overflow: 'auto' }}>
                <AISettingsForm compact highlightJinaKey={highlightJinaKey} onSave={handleSettingsSave} onChatParamsChange={setChatParams} onSaveBusyChange={handleSaveBusyChange} />
              </div>
            ) : (
              <ChatPanel
                messages={messages}
                input={input}
                isLoading={isLoading}
                isSettingsSaving={isSettingsSaving}
                agent={agent}
                onInputChange={handleInputChange}
                onSendMessage={handleSendMessage}
                onClearChat={handleClearChat}
              />
            )}
          </div>
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
      <div style={{
        height: '100vh',
        display: 'flex',
        overflow: 'hidden',
      }}>
        <div style={{
          width: '40%',
          minWidth: '360px',
          maxWidth: '480px',
          borderRight: '1px solid var(--color-border)',
          background: 'var(--color-bg-secondary)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}>
          <div style={{
            padding: 'var(--space-4)',
            borderBottom: '1px solid var(--color-border)',
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}>
            <h2 style={{
              fontSize: 'var(--text-lg)',
              fontWeight: 600,
              color: 'var(--color-text-primary)',
            }}>
              {t('navigation.aiSettings')}
            </h2>
            {/* 保存状态指示器 */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-2)',
              fontSize: 'var(--text-sm)',
              color: saveStatus === 'saving' ? 'var(--color-text-muted)' : saveStatus === 'saved' ? '#10B981' : saveStatus === 'error' ? '#ef4444' : 'var(--color-text-muted)',
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
          </div>
          <div style={{ flex: 1, overflow: 'auto' }}>
            <AISettingsForm compact highlightJinaKey={highlightJinaKey} onSave={handleSettingsSave} onChatParamsChange={setChatParams} onSaveBusyChange={handleSaveBusyChange} />
          </div>
        </div>

        <div style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}>
          <div style={{
            padding: 'var(--space-4)',
            borderBottom: '1px solid var(--color-border)',
            background: 'var(--color-bg-secondary)',
            flexShrink: 0,
          }}>
            <h2 style={{
              fontSize: 'var(--text-lg)',
              fontWeight: 600,
              color: 'var(--color-text-primary)',
            }}>
              {t('playground.preview')}
            </h2>
            <p style={{
              fontSize: 'var(--text-sm)',
              color: 'var(--color-text-muted)',
              marginTop: 'var(--space-2)',
            }}>
              {t('playground.testAiEffect')}
            </p>
          </div>
          <ChatPanel
            messages={messages}
            input={input}
            isLoading={isLoading}
            isSettingsSaving={isSettingsSaving}
            agent={agent}
            onInputChange={handleInputChange}
            onSendMessage={handleSendMessage}
            onClearChat={handleClearChat}
          />
        </div>
      </div>
    </AdminLayout>
  );
}
