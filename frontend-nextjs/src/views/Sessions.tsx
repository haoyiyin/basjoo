'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../context/AuthContext'
import AdminLayout from '../components/AdminLayout'
import HelpTooltip from '../components/HelpTooltip'
import { MarkdownRenderer } from '../components/MarkdownRenderer'
import { useIsMobile } from '../hooks/useMediaQuery'
import { WS_BASE_URL } from '../lib/env'
import { formatAssistantMessageContent } from '../utils/citations'

interface Session {
  id: string
  session_id: string
  visitor_id?: string
  visitor_country?: string
  visitor_city?: string
  status: string
  message_count: number
  created_at: string
  updated_at?: string
  last_message?: string
}

interface Message {
  id: number
  role: string
  content: string
  sources?: Array<{
    type: 'url' | 'qa'
    title?: string
    url?: string
    snippet?: string
    question?: string
    id?: string
  }>
  created_at: string
}

export default function Sessions() {
  const { t } = useTranslation('common')
  const { token } = useAuth()
  const isMobile = useIsMobile()
  const [sessions, setSessions] = useState<Session[]>([])
  const [selectedSession, setSelectedSession] = useState<Session | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [filter, setFilter] = useState<'all' | 'active' | 'taken_over' | 'closed'>('all')
  const [keyword, setKeyword] = useState('')
  const [inputValue, setInputValue] = useState('')
  const [loading, setLoading] = useState(false)
  const [sendingMessage, setSendingMessage] = useState(false)
  const wsRef = useRef<WebSocket | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const reconnectAttemptRef = useRef(0)
  const isMountedRef = useRef(true)
  const selectedSessionRef = useRef<Session | null>(null)

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  const fetchMessages = useCallback(async (sessionId: string) => {
    if (!token) return

    try {
      const response = await fetch(`/api/v1/admin/sessions/${sessionId}/messages`, {
        headers: { Authorization: `Bearer ${token}` },
      })

      if (response.ok) {
        const data = await response.json()
        setMessages(data)
      }
    } catch (error) {
      console.error('Failed to fetch messages:', error)
    }
  }, [token])

  const fetchSessions = useCallback(async () => {
    if (!token) return

    setLoading(true)
    try {
      const statusParam = filter === 'all' ? '' : `&status=${filter}`
      const keywordParam = keyword ? `&keyword=${encodeURIComponent(keyword)}` : ''

      const response = await fetch(
        `/api/v1/admin/sessions?skip=0&limit=50${statusParam}${keywordParam}`,
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      )

      if (response.ok) {
        const data = await response.json()
        setSessions(data.items || [])
      }
    } catch (error) {
      console.error('Failed to fetch sessions:', error)
    } finally {
      setLoading(false)
    }
  }, [filter, keyword, token])

  const connectWebSocket = useCallback(() => {
    if (!token) return

    const wsBaseUrl = WS_BASE_URL || `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}`
    const wsUrl = `${wsBaseUrl}/api/v1/ws/admin?token=${token}`

    try {
      wsRef.current = new WebSocket(wsUrl)

      wsRef.current.onopen = () => {
        reconnectAttemptRef.current = 0
        console.log('WebSocket connected')
      }

      wsRef.current.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data)

          if (data.type === 'session_update' || data.type === 'new_message') {
            void fetchSessions()
            const currentSession = selectedSessionRef.current
            const matchedSessionId = data.sessionDbId || data.sessionId
            if (currentSession && matchedSessionId === currentSession.id) {
              void fetchMessages(currentSession.id)
            }
          }
        } catch (error) {
          console.error('Error parsing WebSocket message:', error)
        }
      }

      wsRef.current.onerror = () => {
        console.log('WebSocket connection error')
      }

      wsRef.current.onclose = () => {
        if (isMountedRef.current) {
          const delay = Math.min(30000, 1000 * (2 ** reconnectAttemptRef.current))
          reconnectAttemptRef.current += 1
          reconnectTimeoutRef.current = setTimeout(connectWebSocket, delay)
        }
      }
    } catch {
      console.log('WebSocket not available')
    }
  }, [fetchMessages, fetchSessions, token])

  useEffect(() => {
    isMountedRef.current = true
    void fetchSessions()

    return () => {
      isMountedRef.current = false
    }
  }, [fetchSessions])

  useEffect(() => {
    if (!token) return

    connectWebSocket()

    return () => {
      if (wsRef.current) {
        wsRef.current.close()
        wsRef.current = null
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current)
        reconnectTimeoutRef.current = null
      }
    }
  }, [connectWebSocket, token])

  useEffect(() => {
    if (selectedSession) {
      void fetchMessages(selectedSession.id)
    }
    selectedSessionRef.current = selectedSession
  }, [fetchMessages, selectedSession])

  useEffect(() => {
    scrollToBottom()
  }, [messages, scrollToBottom])

  const handleTakeover = async (sessionId: string) => {
    try {
      const response = await fetch(`/api/v1/admin/sessions/${sessionId}/takeover`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
      })

      if (!response.ok) {
        console.error('Failed to takeover session:', response.statusText)
        alert(t('errors.takeoverFailed'))
        return
      }

      await fetchSessions()
      if (selectedSession && selectedSession.id === sessionId) {
        setSelectedSession({ ...selectedSession, status: 'taken_over' })
      }
    } catch (error) {
      console.error('Failed to takeover session:', error)
      alert(t('errors.takeoverFailed'))
    }
  }

  const handleSend = async () => {
    if (!inputValue.trim() || !selectedSession) return

    setSendingMessage(true)
    try {
      const response = await fetch('/api/v1/admin/sessions/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          session_id: selectedSession.id,
          content: inputValue,
        }),
      })

      if (!response.ok) {
        console.error('Failed to send message:', response.statusText)
        alert(t('errors.sendFailed'))
        return
      }

      setInputValue('')
      await fetchMessages(selectedSession.id)
    } catch (error) {
      console.error('Failed to send message:', error)
      alert(t('errors.sendFailed'))
    } finally {
      setSendingMessage(false)
    }
  }

  const formatTime = (dateString: string) => {
    const date = new Date(dateString)
    return date.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  return (
    <AdminLayout>
      <div style={{
        height: '100vh',
        display: 'flex',
        flexDirection: isMobile ? 'column' : 'row',
        overflow: 'hidden',
      }}>
        <div style={{
          width: isMobile ? '100%' : '380px',
          height: isMobile ? (selectedSession ? '0' : '100%') : 'auto',
          overflow: isMobile && selectedSession ? 'hidden' : 'auto',
          borderRight: isMobile ? 'none' : '1px solid var(--color-border)',
          borderBottom: isMobile ? '1px solid var(--color-border)' : 'none',
          display: isMobile && selectedSession ? 'none' : 'flex',
          flexDirection: 'column',
          background: 'var(--color-bg-secondary)',
        }}>
          <div style={{
            padding: 'var(--space-6)',
            borderBottom: '1px solid var(--color-border)',
          }}>
            <h1 style={{
              fontSize: 'var(--text-xl)',
              fontWeight: 600,
              color: 'var(--color-text-primary)',
              marginBottom: 'var(--space-4)',
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-3)',
            }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
              {t('settings.chatCenter')}
              <HelpTooltip
                title={t('settings.chatCenter')}
                content={[
                  t('settings.chatCenterDesc'),
                  t('settings.activeDesc'),
                  t('settings.takenOverDesc'),
                  t('settings.endedDesc'),
                  t('settings.searchSupport')
                ]}
                position="right"
                size="sm"
              />
            </h1>

            <div style={{
              display: 'flex',
              gap: 'var(--space-3)',
              marginBottom: 'var(--space-3)',
            }}>
              {(['all', 'active', 'taken_over', 'closed'] as const).map((status) => (
                <button
                  key={status}
                  onClick={() => setFilter(status)}
                  style={{
                    padding: 'var(--space-2) var(--space-3)',
                    fontSize: 'var(--text-xs)',
                    background: filter === status ? 'var(--color-accent-primary)' : 'var(--color-bg-tertiary)',
                    color: filter === status ? 'var(--color-text-inverse)' : 'var(--color-text-secondary)',
                    border: 'none',
                    borderRadius: 'var(--radius-md)',
                    cursor: 'pointer',
                    fontWeight: 500,
                  }}
                >
                  {status === 'all' ? t('status.all') : t(`status.${status === 'taken_over' ? 'takenOver' : status === 'closed' ? 'ended' : status}`)}
                </button>
              ))}
            </div>

            <div style={{ position: 'relative' }}>
              <input
                type="text"
                placeholder={t('placeholders.searchPlaceholder')}
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                style={{
                  paddingLeft: 'var(--space-10)',
                  fontSize: 'var(--text-sm)',
                }}
              />
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                style={{
                  position: 'absolute',
                  left: 'var(--space-3)',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  color: 'var(--color-text-muted)',
                }}
              >
                <circle cx="11" cy="11" r="8" />
                <path d="m21 21-4.35-4.35" />
              </svg>
            </div>
          </div>

          <div style={{
            flex: 1,
            overflow: 'auto',
            padding: 'var(--space-3)',
          }}>
            {loading ? (
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: 'var(--space-10)',
                color: 'var(--color-text-muted)',
              }}>
                <div className="spinner" />
              </div>
            ) : sessions.length === 0 ? (
              <div style={{
                textAlign: 'center',
                padding: 'var(--space-10)',
                color: 'var(--color-text-muted)',
              }}>
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ margin: '0 auto var(--space-4)', opacity: 0.5 }}>
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
                <p>{t('labels.noData')}</p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                {sessions.map((session) => (
                  <div
                    key={session.id}
                    onClick={() => setSelectedSession(session)}
                    style={{
                      padding: 'var(--space-4)',
                      background: selectedSession?.id === session.id
                        ? 'rgba(6, 182, 212, 0.1)'
                        : 'var(--color-bg-tertiary)',
                      border: selectedSession?.id === session.id
                        ? '1px solid var(--color-accent-primary)'
                        : '1px solid var(--color-border)',
                      borderRadius: 'var(--radius-md)',
                      cursor: 'pointer',
                      transition: 'all var(--transition-fast)',
                    }}
                  >
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      marginBottom: 'var(--space-2)',
                    }}>
                      <span style={{
                        fontSize: 'var(--text-sm)',
                        fontWeight: 600,
                        color: 'var(--color-text-primary)',
                      }}>
                        {t('settings.sessionWithId', { id: session.session_id })}
                      </span>
                      <span className={`badge ${session.status === 'active' ? 'badge-success' : session.status === 'taken_over' ? 'badge-warning' : 'badge-info'}`}>
                        {t(`status.${session.status === 'taken_over' ? 'takenOver' : session.status === 'closed' ? 'ended' : session.status}`)}
                      </span>
                    </div>
                    <div style={{
                      fontSize: 'var(--text-xs)',
                      color: 'var(--color-text-muted)',
                      marginBottom: 'var(--space-2)',
                    }}>
                      {session.visitor_id ? `${t('roles.visitor')}: ${session.visitor_id.slice(0, 12)}...` : `${t('roles.visitor')}: -`}
                    </div>
                    {session.last_message && (
                      <p style={{
                        fontSize: 'var(--text-sm)',
                        color: 'var(--color-text-secondary)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        margin: 0,
                      }}>
                        {session.last_message}
                      </p>
                    )}
                    <div style={{
                      fontSize: 'var(--text-xs)',
                      color: 'var(--color-text-muted)',
                      marginTop: 'var(--space-2)',
                    }}>
                      {formatTime(session.updated_at || session.created_at)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--color-bg-primary)',
        }}>
          {selectedSession ? (
            <>
              <div style={{
                padding: 'var(--space-4) var(--space-6)',
                borderBottom: '1px solid var(--color-border)',
                background: 'var(--color-bg-secondary)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 'var(--space-3)',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flex: 1, minWidth: 0 }}>
                  {isMobile && (
                    <button
                      onClick={() => setSelectedSession(null)}
                      className="btn-ghost"
                      style={{ padding: 'var(--space-2)', flexShrink: 0 }}
                    >
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M19 12H5M12 19l-7-7 7-7" />
                      </svg>
                    </button>
                  )}
                  <div style={{ minWidth: 0 }}>
                    <h2 style={{
                      fontSize: 'var(--text-lg)',
                      fontWeight: 600,
                      color: 'var(--color-text-primary)',
                      marginBottom: 'var(--space-1)',
                    }}>
                      {t('settings.sessionWithId', { id: selectedSession.session_id })}
                    </h2>
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 'var(--space-4)',
                      fontSize: 'var(--text-sm)',
                      color: 'var(--color-text-muted)',
                      flexWrap: 'wrap',
                    }}>
                      <span style={{ 
                        overflow: 'hidden', 
                        textOverflow: 'ellipsis', 
                        whiteSpace: 'nowrap',
                        maxWidth: isMobile ? '120px' : 'none',
                      }}>{t('settings.visitorWithId', { id: selectedSession.visitor_id })}</span>
                      {(selectedSession.visitor_country || selectedSession.visitor_city) && (
                        <span style={{
                          fontSize: 'var(--text-xs)',
                          background: 'var(--color-surface-hover)',
                          padding: '2px 8px',
                          borderRadius: 'var(--radius-sm)',
                        }}>
                          📍 {selectedSession.visitor_city || selectedSession.visitor_country}
                        </span>
                      )}
                      <span className={`badge ${selectedSession.status === 'active' ? 'badge-success' : selectedSession.status === 'taken_over' ? 'badge-warning' : 'badge-info'}`}>
                        {t(`status.${selectedSession.status === 'taken_over' ? 'takenOver' : selectedSession.status === 'closed' ? 'ended' : selectedSession.status}`)}
                      </span>
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 'var(--space-3)', flexShrink: 0 }}>
                  {selectedSession.status === 'active' && (
                    <button
                      onClick={() => handleTakeover(selectedSession.id)}
                      style={{
                        padding: 'var(--space-2) var(--space-4)',
                        background: 'var(--color-warning)',
                        color: 'var(--color-text-inverse)',
                        border: 'none',
                        borderRadius: 'var(--radius-md)',
                        fontSize: 'var(--text-sm)',
                        fontWeight: 500,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 'var(--space-2)',
                      }}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                        <circle cx="8.5" cy="7" r="4" />
                        <polyline points="17 11 19 13 23 9" />
                      </svg>
                      {!isMobile && t('labels.takeoverSession')}
                    </button>
                  )}
                  {!isMobile && (
                    <button
                      onClick={() => setSelectedSession(null)}
                      className="btn-ghost"
                      style={{ padding: 'var(--space-2)' }}
                    >
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </button>
                  )}
                </div>
              </div>

              <div style={{
                flex: 1,
                overflow: 'auto',
                padding: 'var(--space-6)',
              }}>
                {messages.length === 0 ? (
                  <div style={{
                    height: '100%',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'var(--color-text-muted)',
                  }}>
                    <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ opacity: 0.5, marginBottom: 'var(--space-4)' }}>
                      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                    </svg>
                    <p>{t('labels.noMessages')}</p>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
                    {messages.map((msg) => {
                      const formattedAssistantContent = msg.role === 'user'
                        ? null
                        : formatAssistantMessageContent(msg.content, msg.sources ?? [])

                      return (
                        <div
                        key={msg.id}
                        style={{
                          display: 'flex',
                          justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start',
                        }}
                      >
                        <div style={{
                          maxWidth: '70%',
                          padding: 'var(--space-4)',
                          borderRadius: 'var(--radius-lg)',
                          background: msg.role === 'user'
                            ? 'var(--color-bg-tertiary)'
                            : 'var(--color-accent-gradient)',
                          color: msg.role === 'user'
                            ? 'var(--color-text-primary)'
                            : 'var(--color-text-inverse)',
                        }}>
                          <div style={{
                            fontSize: 'var(--text-xs)',
                            opacity: 0.7,
                            marginBottom: 'var(--space-1)',
                          }}>
                            {msg.role === 'user' ? t('roles.visitor') : t('roles.agent')}
                          </div>
                          <div style={{
                            fontSize: 'var(--text-base)',
                            lineHeight: 1.6,
                            whiteSpace: msg.role === 'user' ? 'pre-wrap' : undefined,
                          }}>
                            {msg.role === 'user' ? msg.content : (
                              <>
                                <MarkdownRenderer content={formattedAssistantContent?.content ?? msg.content} />
                                {formattedAssistantContent && formattedAssistantContent.references.length > 0 && (
                                  <div style={{ marginTop: 'var(--space-3)', paddingTop: 'var(--space-3)', borderTop: '1px solid rgba(255,255,255,0.25)' }}>
                                    <div style={{ fontSize: 'var(--text-xs)', opacity: 0.85, marginBottom: 'var(--space-2)', fontWeight: 600 }}>
                                      {t('citations.references')}
                                    </div>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                                      {formattedAssistantContent.references.map((reference) => (
                                        <a
                                          key={reference.url}
                                          href={reference.url}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          style={{ color: 'inherit', textDecoration: 'underline', fontSize: 'var(--text-sm)', fontWeight: 600, wordBreak: 'break-word' }}
                                        >
                                          {reference.title}
                                        </a>
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </>
                            )}
                          </div>
                          <div style={{
                            fontSize: 'var(--text-xs)',
                            opacity: 0.6,
                            marginTop: 'var(--space-2)',
                          }}>
                            {formatTime(msg.created_at)}
                          </div>
                        </div>
                      </div>
                      )
                    })}
                    <div ref={messagesEndRef} />
                  </div>
                )}
              </div>

              {selectedSession.status === 'taken_over' && (
                <div style={{
                  padding: 'var(--space-4) var(--space-6)',
                  borderTop: '1px solid var(--color-border)',
                  background: 'var(--color-bg-secondary)',
                }}>
                  <div style={{
                    display: 'flex',
                    gap: 'var(--space-3)',
                  }}>
                    <input
                      type="text"
                      value={inputValue}
                      onChange={(e) => setInputValue(e.target.value)}
                      onKeyPress={(e) => e.key === 'Enter' && handleSend()}
                      placeholder={t('placeholders.enterMessage')}
                      disabled={sendingMessage}
                      style={{
                        flex: 1,
                        padding: 'var(--space-4)',
                      }}
                    />
                    <button
                      onClick={handleSend}
                      disabled={sendingMessage || !inputValue.trim()}
                      style={{
                        padding: 'var(--space-4) var(--space-6)',
                        background: 'var(--color-accent-gradient)',
                        color: 'var(--color-text-inverse)',
                        border: 'none',
                        borderRadius: 'var(--radius-md)',
                        fontWeight: 600,
                        cursor: sendingMessage || !inputValue.trim() ? 'not-allowed' : 'pointer',
                        opacity: sendingMessage || !inputValue.trim() ? 0.5 : 1,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 'var(--space-2)',
                      }}
                    >
                      {sendingMessage ? (
                        <div className="spinner" />
                      ) : (
                        <>
                          {t('buttons.send')}
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <line x1="22" y1="2" x2="11" y2="13" />
                            <polygon points="22 2 15 22 11 13 2 9 22 2" />
                          </svg>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--color-text-muted)',
              padding: 'var(--space-10)',
            }}>
              <div style={{
                width: '120px',
                height: '120px',
                background: 'var(--color-bg-tertiary)',
                borderRadius: 'var(--radius-xl)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: 'var(--space-6)',
              }}>
                <svg width="60" height="60" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ opacity: 0.5 }}>
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
              </div>
              <h3 style={{
                fontSize: 'var(--text-xl)',
                fontWeight: 600,
                color: 'var(--color-text-primary)',
                marginBottom: 'var(--space-2)',
              }}>
                {t('labels.selectSession')}
              </h3>
              <p style={{
                fontSize: 'var(--text-sm)',
                textAlign: 'center',
                maxWidth: '300px',
              }}>
                {t('labels.selectSessionDesc')}
              </p>
            </div>
          )}
        </div>
      </div>
    </AdminLayout>
  )
}
