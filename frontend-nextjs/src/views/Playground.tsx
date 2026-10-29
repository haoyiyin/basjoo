'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import type { KeyboardEvent } from 'react';
import { flushSync } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useParams, useSearchParams } from 'react-router-dom';
import { api } from '../services/api'
import type { Agent as ApiAgent, ChatRequest, Source, StreamDoneMeta, UsageInfo } from '../services/api';
import AdminLayout from '../components/AdminLayout';
import AISettingsForm from '../components/AISettingsForm';
import ChatPanel from '../components/ChatPanel';
import type { Message as ChatPanelMessage, Agent as ChatPanelAgent } from '../components/ChatPanel';
import { useMediaQuery } from '../hooks/useMediaQuery';

interface ChatParamOverrides {
  temperature: number;
  max_tokens: number;
}

type PlaygroundTab = 'settings' | 'chat';

/* Tab order is DOM order (设置 before 测试); the default tab is 测试 because
 * testing is the frequent action. */
const TAB_ORDER: PlaygroundTab[] = ['settings', 'chat'];

export default function Playground() {
  const { t, i18n } = useTranslation('common');
  const { agentId: routeAgentId } = useParams<{ agentId?: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  /* Tabbed mode owns its own breakpoint: CSS switches to two columns at
   * 1025px (index.css), so JS must flip at the same width or both panes mount
   * into a one-column shell. `useIsMobile` (768px) is the admin shell's
   * contract and must not move. */
  const isNarrow = useMediaQuery('(max-width: 1024px)');
  const tab: PlaygroundTab =
    searchParams.get('tab') === 'settings' ? 'settings' : 'chat';
  const settingsTabRef = useRef<HTMLButtonElement>(null);
  const chatTabRef = useRef<HTMLButtonElement>(null);
  const [agentId, setAgentId] = useState<string | null>(null);
  const [agent, setAgent] = useState<ChatPanelAgent | null>(null);
  const [messages, setMessages] = useState<ChatPanelMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [sessionId, setSessionId] = useState<string | undefined>();
  const [isSettingsSaving, setIsSettingsSaving] = useState(false);
  // null = agent not loaded yet. `false` means the backend reports no LLM key,
  // which blocks the SSE stream and the send control (issue #19).
  const [apiKeySet, setApiKeySet] = useState<boolean | null>(null);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [chatParams, setChatParams] = useState<ChatParamOverrides>({
    temperature: 0.7,
    max_tokens: 1024,
  });
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const streamingMessageClientIdRef = useRef<number | null>(null);
  const nextMessageClientIdRef = useRef(0);
  const streamAbortControllerRef = useRef<AbortController | null>(null);
  const streamRequestIdRef = useRef(0);

  useEffect(() => {
    loadDefaultAgent();
  }, [routeAgentId]);

  const loadDefaultAgent = async () => {
    try {
      const pathAgentId = typeof window !== 'undefined'
        ? window.location.pathname.match(/\/agents\/([^/]+)/)?.[1]
        : undefined;
      const currentAgentId = routeAgentId || pathAgentId;
      if (!currentAgentId) return;
      const data = await api.getAgent(currentAgentId);
      setAgent(data);
      setAgentId(data.id);
      const hasApiKey = Boolean(data.api_key_set);
      setApiKeySet(hasApiKey);
      setChatParams({
        temperature: data.temperature,
        max_tokens: data.max_tokens,
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
    const effectiveAgentId = agentId || agent?.id || null;
    // Hard gate: never open the SSE stream when no LLM API key is configured.
    if (apiKeySet !== true) return;
    if (!input.trim() || isLoading || isSettingsSaving || !effectiveAgentId) return;

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

    const updateStreamingMessage = (
      updater: (message: ChatPanelMessage) => ChatPanelMessage,
      options?: { sync?: boolean }
    ) => {
      if (isStaleRequest()) {
        return;
      }

      const applyUpdate = () => {
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

      if (options?.sync) {
        flushSync(applyUpdate);
      } else {
        applyUpdate();
      }
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
          thinkingElapsed: undefined,
          /* #44: the SSE `done` event carries the flag; ChatPanel renders the
           * "answered with the fallback model" line from it. */
          degraded: meta?.degraded ?? false,
          model: meta?.model ?? null,
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
        agent_id: effectiveAgentId,
        message: currentInput,
        locale: i18n.language,
        session_id: sessionId,
        params: {
          temperature: chatParams.temperature,
          max_tokens: chatParams.max_tokens,
        },
        /* #44: the Playground is the operator's own test surface, so its turns
         * never consume the daily allowance. The backend ignores the flag
         * without an admin token, so this cannot leak to the public widget. */
        preview: true,
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
        onThinking: (elapsed) => {
          if (isStaleRequest()) {
            return;
          }
          updateStreamingMessage(message => ({
            ...message,
            thinkingElapsed: elapsed,
          }));
        },
        onThinkingDone: () => {
          if (isStaleRequest()) {
            return;
          }
          updateStreamingMessage(message => ({
            ...message,
            thinkingElapsed: undefined,
          }));
        },
        onContent: (chunk) => {
          if (isStaleRequest()) {
            return;
          }
          updateStreamingMessage(message => ({
            ...message,
            content: message.content + chunk,
            thinkingElapsed: undefined,
          }), { sync: true });
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
  }, [apiKeySet, input, isLoading, isSettingsSaving, agentId, agent?.id, chatParams, sessionId, i18n.language, getErrorMessage]);

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
      setApiKeySet(Boolean(updatedAgent.api_key_set));
      setChatParams({
        temperature: updatedAgent.temperature,
        max_tokens: updatedAgent.max_tokens,
      });
    }

    setSaveStatus('saved');
    if (savedTimerRef.current) {
      clearTimeout(savedTimerRef.current);
    }
    savedTimerRef.current = setTimeout(() => {
      setSaveStatus('idle');
    }, 2000);
  }, []);

  const handleSettingsSaveError = useCallback(() => {
    setSaveStatus('error');
    if (savedTimerRef.current) {
      clearTimeout(savedTimerRef.current);
    }
    savedTimerRef.current = setTimeout(() => {
      setSaveStatus('idle');
    }, 2000);
  }, []);

  const handleSaveBusyChange = useCallback((busy: boolean) => {
    setIsSettingsSaving(busy);
    if (busy) {
      setSaveStatus('saving');
    }
  }, []);

  const selectTab = useCallback((next: PlaygroundTab) => {
    const params = new URLSearchParams(searchParams);
    params.set('tab', next);
    setSearchParams(params, { replace: true });
  }, [searchParams, setSearchParams]);

  const handleTabKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    const index = TAB_ORDER.indexOf(tab);
    let next: PlaygroundTab | null = null;
    if (event.key === 'ArrowRight') {
      next = TAB_ORDER[(index + 1) % TAB_ORDER.length];
    } else if (event.key === 'ArrowLeft') {
      next = TAB_ORDER[(index - 1 + TAB_ORDER.length) % TAB_ORDER.length];
    } else if (event.key === 'Home') {
      next = TAB_ORDER[0];
    } else if (event.key === 'End') {
      next = TAB_ORDER[TAB_ORDER.length - 1];
    }
    if (!next) return;
    event.preventDefault();
    selectTab(next);
    (next === 'settings' ? settingsTabRef : chatTabRef).current?.focus();
  }, [tab, selectTab]);

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

  /*
   * Two layouts, one URL contract.
   *
   * Tabbed (<= 1024px, the two-column breakpoint in index.css): two tabs,
   * exactly one pane mounted (`?tab=settings|chat`, default chat) so chat owns
   * the full width; the strip is arrow-key driven and the panes are
   * `tabpanel`s.
   *
   * Desktop (>= 1025px): both panes are mounted side by side — settings left, chat right, each with its own scroll — and
   * they are plain `region`s labelled by their own heading. The tab strip stays
   * in the DOM for the mobile contract but is hidden (from the screen and from
   * the a11y tree), and `?tab=` no longer hides a pane: on desktop it only
   * records the last tab picked on a phone. Mounting both is the point —
   * `AISettingsForm`'s chat params reach the chat panel without a remount.
   */
  return (
    <AdminLayout>
      <div data-testid="playground-shell" className="admin-page playground-shell">
        <header className="page-header playground-header">
          <div className="playground-heading">
            <h1 className="page-title">{t('navigation.playground')}</h1>
            <p className="page-subtitle">{t('playground.testAiEffect')}</p>
          </div>
          <div
            data-testid="playground-tabs"
            className="playground-tabs"
            role="tablist"
            aria-label={t('navigation.playground')}
            onKeyDown={handleTabKeyDown}
            style={isNarrow ? undefined : { display: 'none' }}
          >
            <button
              ref={settingsTabRef}
              type="button"
              role="tab"
              id="playground-tab-settings"
              className="playground-tab"
              aria-selected={tab === 'settings'}
              aria-controls="playground-panel-settings"
              tabIndex={tab === 'settings' ? 0 : -1}
              onClick={() => selectTab('settings')}
            >
              {t('playground.tabSettings')}
            </button>
            <button
              ref={chatTabRef}
              type="button"
              role="tab"
              id="playground-tab-chat"
              className="playground-tab"
              aria-selected={tab === 'chat'}
              aria-controls="playground-panel-chat"
              tabIndex={tab === 'chat' ? 0 : -1}
              onClick={() => selectTab('chat')}
            >
              {t('playground.tabChat')}
            </button>
          </div>
        </header>

        {(isNarrow ? tab === 'settings' : true) && (
          <section
            data-testid="playground-pane-settings"
            id="playground-panel-settings"
            className="playground-panel playground-pane-settings"
            role={isNarrow ? 'tabpanel' : 'region'}
            aria-labelledby={
              isNarrow ? 'playground-tab-settings' : 'playground-settings-heading'
            }
          >
            <div className="playground-settings-column">
              <div className="card-header playground-settings-header">
                <h2 className="card-title" id="playground-settings-heading">
                  {t('navigation.aiSettings')}
                </h2>
                <div
                  role="status"
                  aria-live="polite"
                  className="playground-status"
                  data-state={saveStatus}
                >
                  {saveStatus === 'saving' && (
                    <>
                      <div className="spinner playground-status-spinner" />
                      <span>{t('status.saving')}</span>
                    </>
                  )}
                  {saveStatus === 'saved' && <span>{t('status.saved')}</span>}
                  {saveStatus === 'error' && <span>{t('status.error')}</span>}
                </div>
              </div>
              <AISettingsForm agentId={agentId || undefined} compact onSave={handleSettingsSave} onSaveError={handleSettingsSaveError} onChatParamsChange={setChatParams} onSaveBusyChange={handleSaveBusyChange} />
            </div>
          </section>
        )}

        {(isNarrow ? tab === 'chat' : true) && (
          <section
            data-testid="playground-pane-chat"
            id="playground-panel-chat"
            className="playground-panel playground-pane-chat"
            role={isNarrow ? 'tabpanel' : 'region'}
            aria-labelledby={
              isNarrow ? 'playground-tab-chat' : 'playground-chat-heading'
            }
          >
            {!isNarrow && (
              <div className="card-header playground-pane-header">
                <h2 className="card-title" id="playground-chat-heading">
                  {t('playground.tabChat')}
                </h2>
              </div>
            )}
            {/* On the narrow (tabbed) layout the settings pane is not mounted,
             * so the chat tab is the only place the missing-key warning can
             * appear — keep it there. On the desktop two-pane layout the
             * settings rail already shows it, and a second verbatim copy with
             * no icon read as a different message saying the same thing. */}
            {isNarrow && apiKeySet === false && (
              <div role="alert" className="playground-warning">
                {t('labels.pleaseConfigureApiKey')}
              </div>
            )}
            <ChatPanel
              messages={messages}
              input={input}
              isLoading={isLoading}
              isSettingsSaving={isSettingsSaving}
              agent={agent}
              sendDisabled={apiKeySet !== true}
              onInputChange={handleInputChange}
              onSendMessage={handleSendMessage}
              onClearChat={handleClearChat}
            />
          </section>
        )}
      </div>
    </AdminLayout>
  );
}
