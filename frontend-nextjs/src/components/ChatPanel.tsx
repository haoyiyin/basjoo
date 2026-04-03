'use client';

import { useRef, useEffect, memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Source, UsageInfo } from '../services/api';
import { MarkdownRenderer } from './MarkdownRenderer';

export interface Message {
  clientId?: number;
  role: 'user' | 'assistant';
  content: string;
  sources?: Source[];
  usage?: UsageInfo;
  isStreaming?: boolean;
  thinkingElapsed?: number;
  timestamp: Date;
}

export interface Agent {
  id?: string;
  name: string;
  model: string;
  temperature: number;
  max_tokens: number;
  system_prompt: string;
  reasoning_effort?: 'low' | 'medium' | 'high' | null;
}

interface ChatPanelProps {
  messages: Message[];
  input: string;
  isLoading: boolean;
  isSettingsSaving?: boolean;
  agent: Agent | null;
  onInputChange: (value: string) => void;
  onSendMessage: () => void;
  onClearChat: () => void;
}

// Source type icon component
function SourceIcon({ type }: { type: string }) {
  if (type === 'url') {
    return (
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
      </svg>
    );
  }
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="10" />
      <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

// Citation card component
function CitationCard({ source, index }: { source: Source; index: number }) {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div
      style={{
        background: 'var(--color-bg-secondary)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-md)',
        overflow: 'hidden',
        transition: 'all 0.2s ease',
      }}
    >
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        aria-expanded={isExpanded}
        aria-label={source.type === 'url' ? (source.title || source.url || 'citation source') : (source.question || 'citation source')}
        style={{
          width: '100%',
          padding: '8px 12px',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          fontSize: 'var(--text-xs)',
          color: 'var(--color-text-secondary)',
          textAlign: 'left',
        }}
      >
        <span
          style={{
            width: '18px',
            height: '18px',
            borderRadius: '4px',
            background: 'var(--color-accent-primary)',
            color: 'white',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '10px',
            fontWeight: 600,
            flexShrink: 0,
          }}
        >
          {index + 1}
        </span>
        <SourceIcon type={source.type} />
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {source.type === 'url' ? (source.title || source.url) : source.question}
        </span>
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          style={{
            transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: 'transform 0.2s',
            flexShrink: 0,
          }}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {isExpanded && (
        <div
          style={{
            padding: '8px 12px',
            borderTop: '1px solid var(--color-border)',
            fontSize: 'var(--text-xs)',
            color: 'var(--color-text-muted)',
            animation: 'slideDown 0.2s ease-out',
          }}
        >
          {source.type === 'url' && source.url ? (
            <a
              href={source.url}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                color: 'var(--color-accent-primary)',
                textDecoration: 'none',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
              }}
            >
              {source.url}
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                <polyline points="15 3 21 3 21 9" />
                <line x1="10" y1="14" x2="21" y2="3" />
              </svg>
            </a>
          ) : (
            <div>{source.snippet || source.question}</div>
          )}
        </div>
      )}
    </div>
  );
}

// Loading dots animation
function LoadingDots() {
  return (
    <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
      <span
        style={{
          width: '6px',
          height: '6px',
          borderRadius: '50%',
          background: 'var(--color-accent-primary)',
          animation: 'bounce 1.4s ease-in-out 0s infinite both',
        }}
      />
      <span
        style={{
          width: '6px',
          height: '6px',
          borderRadius: '50%',
          background: 'var(--color-accent-primary)',
          animation: 'bounce 1.4s ease-in-out 0.16s infinite both',
        }}
      />
      <span
        style={{
          width: '6px',
          height: '6px',
          borderRadius: '50%',
          background: 'var(--color-accent-primary)',
          animation: 'bounce 1.4s ease-in-out 0.32s infinite both',
        }}
      />
    </div>
  );
}

function ChatPanel({
  messages,
  input,
  isLoading,
  isSettingsSaving = false,
  agent,
  onInputChange,
  onSendMessage,
  onClearChat,
}: ChatPanelProps) {
  const { t } = useTranslation('common');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [agentIdCopied, setAgentIdCopied] = useState(false);

  const handleCopyAgentId = async () => {
    if (!agent?.id) {
      return;
    }
    try {
      await navigator.clipboard.writeText(agent.id);
    } catch {
      const textArea = document.createElement('textarea');
      textArea.value = agent.id;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
    }
    setAgentIdCopied(true);
    window.setTimeout(() => setAgentIdCopied(false), 2000);
  };

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  return (
    <div style={{
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      height: '100%',
    }}>
      {/* Agent Info Bar */}
      {agent && (
        <div style={{
          padding: 'var(--space-3) var(--space-4)',
          borderBottom: '1px solid var(--color-border)',
          background: 'var(--color-bg-tertiary)',
          flexShrink: 0,
        }}>
          <div style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 'var(--space-3)',
            alignItems: 'center',
          }}>
            {/* Agent Name Tag */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '4px 10px',
              background: 'var(--color-bg-glass)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-full)',
              fontSize: 'var(--text-xs)',
            }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: 'var(--color-accent-primary)' }}>
                <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                <line x1="12" y1="19" x2="12" y2="23" />
                <line x1="8" y1="23" x2="16" y2="23" />
              </svg>
              <span style={{ color: 'var(--color-text-muted)' }}>{t('playground.agent')}</span>
              <span style={{ color: 'var(--color-text-primary)', fontWeight: 500 }}>{agent.name}</span>
            </div>

            {/* Model Tag */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '4px 10px',
              background: 'var(--color-accent-bg, rgba(6, 182, 212, 0.1))',
              border: '1px solid var(--color-accent-primary)',
              borderRadius: 'var(--radius-full)',
              fontSize: 'var(--text-xs)',
            }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: 'var(--color-accent-primary)' }}>
                <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
                <line x1="8" y1="21" x2="16" y2="21" />
                <line x1="12" y1="17" x2="12" y2="21" />
              </svg>
              <span style={{ color: 'var(--color-accent-primary)', fontWeight: 500 }}>{agent.model}</span>
            </div>

            {/* Temperature Tag */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '4px 10px',
              background: 'var(--color-bg-glass)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-full)',
              fontSize: 'var(--text-xs)',
            }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: 'var(--color-warning)' }}>
                <path d="M14 14.76V3.5a2.5 2.5 0 0 0-5 0v11.26a4.5 4.5 0 1 0 5 0z" />
              </svg>
              <span style={{ color: 'var(--color-text-muted)' }}>{t('playground.temperature')}</span>
              <span style={{ color: 'var(--color-text-primary)', fontWeight: 500 }}>{agent.temperature}</span>
            </div>

            {agent.id && (
              <button
                onClick={handleCopyAgentId}
                aria-label="Copy Agent ID"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '4px 10px',
                  background: 'var(--color-bg-glass)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-full)',
                  fontSize: 'var(--text-xs)',
                  cursor: 'pointer',
                  color: agentIdCopied ? 'var(--color-success)' : 'var(--color-text-muted)',
                  fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Consolas, monospace',
                }}
                title={agentIdCopied ? t('status.success') : t('buttons.copy')}
              >
                <span>Agent ID</span>
                <span style={{ color: 'var(--color-text-primary)', fontWeight: 500 }}>{agent.id}</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Messages Area */}
      <div style={{
        flex: 1,
        overflow: 'auto',
        padding: 'var(--space-4)',
        background: 'var(--color-bg-primary)',
      }} aria-live="polite">
        {messages.length === 0 ? (
          <div style={{
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--color-text-muted)',
          }}>
            <div style={{
              width: '72px',
              height: '72px',
              background: 'var(--color-bg-tertiary)',
              borderRadius: 'var(--radius-xl)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: 'var(--space-4)',
              border: '1px solid var(--color-border)',
              boxShadow: 'var(--shadow-md)',
            }}>
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ color: 'var(--color-accent-primary)' }}>
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
            </div>
            <p style={{ fontSize: 'var(--text-lg)', fontWeight: 600, color: 'var(--color-text-primary)' }}>
              {t('playground.startChat')}
            </p>
            <p style={{ fontSize: 'var(--text-sm)', marginTop: 'var(--space-2)', color: 'var(--color-text-muted)' }}>
              {t('playground.startChatHint')}
            </p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
            {messages.map((msg, idx) => (
              <div
                key={msg.clientId ?? idx}
                style={{
                  display: 'flex',
                  justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start',
                  animation: 'fadeIn 0.3s ease-out forwards',
                }}
              >
                <div style={{
                  maxWidth: '85%',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 'var(--space-2)',
                }}>
                  {/* Message Bubble */}
                  <div style={{
                    padding: 'var(--space-3) var(--space-4)',
                    borderRadius: msg.role === 'user'
                      ? 'var(--radius-lg) var(--radius-lg) 4px var(--radius-lg)'
                      : 'var(--radius-lg) var(--radius-lg) var(--radius-lg) 4px',
                    background: msg.role === 'user'
                      ? 'var(--color-accent-gradient)'
                      : 'var(--color-bg-tertiary)',
                    color: msg.role === 'user'
                      ? 'var(--color-text-inverse)'
                      : 'var(--color-text-primary)',
                    boxShadow: msg.role === 'user'
                      ? '0 4px 12px rgba(6, 182, 212, 0.25)'
                      : '0 2px 8px var(--color-shadow)',
                    borderLeft: msg.role === 'assistant'
                      ? '3px solid var(--color-accent-primary)'
                      : 'none',
                  }}>
                    <div style={{
                      fontSize: 'var(--text-sm)',
                      lineHeight: 1.7,
                    }}>
                      {msg.role === 'assistant' ? (
                        <div>
                          {msg.isStreaming && !msg.content && typeof msg.thinkingElapsed === 'number' ? (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                              <LoadingDots />
                              <span style={{ color: 'var(--color-text-muted)' }}>
                                {typeof msg.thinkingElapsed === 'number'
                                  ? `${t('status.thinking')} ${msg.thinkingElapsed}s`
                                  : t('status.thinking')}
                              </span>
                            </div>
                          ) : msg.isStreaming && !msg.content ? (
                            <span
                              style={{
                                display: 'inline-block',
                                width: '0.5rem',
                                height: '1em',
                                verticalAlign: 'text-bottom',
                                background: 'var(--color-accent-primary)',
                                animation: 'blinkCursor 1s steps(1) infinite',
                              }}
                            />
                          ) : (
                            <>
                              {msg.isStreaming ? (
                                <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{msg.content}</div>
                              ) : (
                                <MarkdownRenderer content={msg.content} />
                              )}
                              {msg.isStreaming && (
                                <span
                                  style={{
                                    display: 'inline-block',
                                    width: '0.5rem',
                                    height: '1em',
                                    marginLeft: '0.15rem',
                                    verticalAlign: 'text-bottom',
                                    background: 'var(--color-accent-primary)',
                                    animation: 'blinkCursor 1s steps(1) infinite',
                                  }}
                                />
                              )}
                            </>
                          )}
                        </div>
                      ) : (
                        <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{msg.content}</div>
                      )}
                    </div>
                  </div>

                  {/* Citations */}
                  {msg.sources && msg.sources.length > 0 && (
                    <div style={{
                      marginLeft: msg.role === 'assistant' ? 'var(--space-2)' : 0,
                      marginRight: msg.role === 'user' ? 'var(--space-2)' : 0,
                    }}>
                      <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        marginBottom: 'var(--space-2)',
                        fontSize: 'var(--text-xs)',
                        color: 'var(--color-text-muted)',
                      }}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                          <polyline points="14 2 14 8 20 8" />
                          <line x1="16" y1="13" x2="8" y2="13" />
                          <line x1="16" y1="17" x2="8" y2="17" />
                          <polyline points="10 9 9 9 8 9" />
                        </svg>
                        {t('playground.sources')} ({msg.sources.length})
                      </div>
                      <div style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 'var(--space-1)',
                      }}>
                        {msg.sources.map((source, sidx) => (
                          <CitationCard key={sidx} source={source} index={sidx} />
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Token Usage (for assistant messages) */}
                  {msg.role === 'assistant' && msg.usage && (
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 'var(--space-3)',
                      marginLeft: 'var(--space-2)',
                      fontSize: 'var(--text-xs)',
                      color: 'var(--color-text-muted)',
                    }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
                        </svg>
                        {msg.usage.total_tokens} tokens
                      </span>
                    </div>
                  )}
                </div>
              </div>
            ))}

            {/* Loading State */}
            {isLoading && !messages.some((message) => message.isStreaming) && (
              <div style={{
                display: 'flex',
                justifyContent: 'flex-start',
              }}>
                <div style={{
                  padding: 'var(--space-3) var(--space-4)',
                  background: 'var(--color-bg-tertiary)',
                  borderRadius: 'var(--radius-lg) var(--radius-lg) var(--radius-lg) 4px',
                  borderLeft: '3px solid var(--color-accent-primary)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--space-3)',
                  boxShadow: '0 2px 8px var(--color-shadow)',
                }}>
                  <LoadingDots />
                  <span style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)' }}>
                    {t('status.thinking')}
                  </span>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Input Area */}
      <div style={{
        padding: 'var(--space-4)',
        borderTop: '1px solid var(--color-border)',
        background: 'var(--color-bg-secondary)',
        flexShrink: 0,
        boxShadow: '0 -4px 12px rgba(0, 0, 0, 0.1)',
      }}>
        <div style={{
          display: 'flex',
          gap: 'var(--space-2)',
          alignItems: 'stretch',
        }}>
          <div style={{
            flex: 1,
            position: 'relative',
          }}>
            <input
              type="text"
              aria-label={t('playground.inputPlaceholder')}
              value={input}
              onChange={(e) => onInputChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                  e.preventDefault()
                  onSendMessage()
                }
              }}
              placeholder={isSettingsSaving ? t('status.saving') : t('playground.inputPlaceholder')}
              disabled={isLoading || isSettingsSaving}
              style={{
                width: '100%',
                height: '100%',
                padding: 'var(--space-3) var(--space-4)',
                paddingRight: 'var(--space-10)',
                borderRadius: 'var(--radius-lg)',
                border: '1px solid var(--color-border)',
                background: 'var(--color-bg-primary)',
                color: 'var(--color-text-primary)',
                fontSize: 'var(--text-sm)',
                outline: 'none',
                transition: 'all 0.2s ease',
              }}
            />
            {input.length > 0 && (
              <button
                onClick={() => onInputChange('')}
                aria-label={t('buttons.clear')}
                style={{
                  position: 'absolute',
                  right: '12px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'var(--color-bg-tertiary)',
                  border: 'none',
                  borderRadius: '50%',
                  width: '20px',
                  height: '20px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  color: 'var(--color-text-muted)',
                  padding: 0,
                }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            )}
          </div>
          <button
            onClick={onClearChat}
            aria-label={t('buttons.clear')}
            className="btn-secondary"
            style={{
              padding: 'var(--space-3)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              minWidth: '44px',
              borderRadius: 'var(--radius-lg)',
            }}
            title={t('buttons.clear')}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            </svg>
          </button>
          <button
            onClick={onSendMessage}
            aria-label={t('buttons.send')}
            disabled={isLoading || isSettingsSaving || !input.trim()}
            style={{
              padding: 'var(--space-3) var(--space-5)',
              background: 'var(--color-accent-gradient)',
              color: 'var(--color-text-inverse)',
              border: 'none',
              borderRadius: 'var(--radius-lg)',
              fontWeight: 600,
              fontSize: 'var(--text-sm)',
              cursor: isLoading || isSettingsSaving || !input.trim() ? 'not-allowed' : 'pointer',
              opacity: isLoading || isSettingsSaving || !input.trim() ? 0.5 : 1,
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-2)',
              boxShadow: isLoading || isSettingsSaving || !input.trim() ? 'none' : '0 4px 12px rgba(6, 182, 212, 0.3)',
              transition: 'all 0.2s ease',
              minWidth: '100px',
            }}
          >
            {isSettingsSaving ? t('status.saving') : t('buttons.send')}
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </button>
        </div>
      </div>

      {/* Animations */}
      <style>{`
        @keyframes fadeIn {
          from {
            opacity: 0;
            transform: translateY(8px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        @keyframes slideDown {
          from {
            opacity: 0;
            max-height: 0;
          }
          to {
            opacity: 1;
            max-height: 200px;
          }
        }

        @keyframes bounce {
          0%, 80%, 100% {
            transform: scale(0.6);
            opacity: 0.5;
          }
          40% {
            transform: scale(1);
            opacity: 1;
          }
        }

        @keyframes blinkCursor {
          0%, 50% {
            opacity: 1;
          }
          50.01%, 100% {
            opacity: 0;
          }
        }
      `}</style>
    </div>
  );
}

export default memo(ChatPanel);
