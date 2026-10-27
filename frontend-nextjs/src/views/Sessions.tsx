'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import AdminLayout from '../components/AdminLayout'
import HelpTooltip from '../components/HelpTooltip'
import { Icon } from '../components/Icon'
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
    type: 'url' | 'file'
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
  const { agentId } = useParams<{ agentId?: string }>()
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
        `/api/v1/admin/sessions?skip=0&limit=50${agentId ? `&agent_id=${agentId}` : ''}${statusParam}${keywordParam}`,
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
    const wsUrl = `${wsBaseUrl}/api/v1/ws/admin?token=${token}${agentId ? `&agent_id=${agentId}` : ''}`

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

      wsRef.current.onclose = (event) => {
        // Do not reconnect after intentional close (logout, unmount cleanup).
        if (!isMountedRef.current) return
        // Normal closure (1000) or policy close (1001) should not trigger reconnect.
        if (event.code === 1000 || event.code === 1001) return

        const delay = Math.min(30000, 1000 * (2 ** reconnectAttemptRef.current))
        reconnectAttemptRef.current += 1
        reconnectTimeoutRef.current = setTimeout(connectWebSocket, delay)
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
  const rowStyle = isMobile
    ? { flexDirection: 'column' as const, alignItems: 'stretch' as const }
    : undefined
  const iconButtonStyle = isMobile
    ? { minWidth: 44, minHeight: 44 }
    : undefined

  const statusBadgeClass = (status: string) =>
    `badge ${status === 'active' ? 'badge-success' : status === 'taken_over' ? 'badge-warning' : 'badge-info'}`

  const statusLabel = (status: string) =>
    t(`status.${status === 'taken_over' ? 'takenOver' : status === 'closed' ? 'ended' : status}`)

  return (
    <AdminLayout>
      <div
        className="admin-page"
        data-testid="sessions-page"
        style={{
          display: 'flex',
          flexDirection: 'column',
          // R1: at mobile width the document scrolls; a 100vh flex column here
          // would constrain the list/messages panes and give them their own
          // scrollbars. Desktop keeps the viewport-height workspace.
          minHeight: isMobile ? 'auto' : '100vh',
          paddingBottom: 0,
        }}
      >
        <header className="page-header">
          <div style={{ minWidth: 0 }}>
            <h1 className="page-title">
              {t('settings.chatCenter')}
              <HelpTooltip
                title={t('settings.chatCenter')}
                content={[
                  t('settings.chatCenterDesc'),
                  t('settings.activeDesc'),
                  t('settings.takenOverDesc'),
                  t('settings.endedDesc'),
                  t('settings.searchSupport'),
                ]}
                position="bottom"
                size="sm"
              />
            </h1>
            <p className="page-subtitle">{t('settings.chatCenterDesc')}</p>
          </div>
          <div className="page-actions">
            {(['all', 'active', 'taken_over', 'closed'] as const).map((status) => (
              <button
                key={status}
                type="button"
                className={filter === status ? 'btn btn-primary' : 'btn btn-secondary'}
                aria-pressed={filter === status}
                onClick={() => setFilter(status)}
              >
                {statusLabel(status)}
              </button>
            ))}
          </div>
        </header>

        <div
          style={{
            display: 'flex',
            flex: 1,
            minHeight: 0,
            gap: 'var(--space-4)',
            flexDirection: isMobile ? 'column' : 'row',
            alignItems: 'stretch',
            paddingBottom: isMobile ? 0 : 'var(--space-4)',
          }}
        >
          {/* Session list */}
          <section
            aria-label={t('settings.chatCenter')}
            style={{
              display: isMobile && selectedSession ? 'none' : 'flex',
              flexDirection: 'column',
              gap: 'var(--space-3)',
              width: isMobile ? '100%' : '360px',
              flexShrink: 0,
              minWidth: 0,
              minHeight: 0,
            }}
          >
            <div className="field" style={{ marginBottom: 0 }}>
              <label className="field-label" htmlFor="sessions-search">
                {t('buttons.search')}
              </label>
              <input
                id="sessions-search"
                className="input"
                type="search"
                placeholder={t('placeholders.searchPlaceholder')}
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
              />
            </div>

            <div
              style={{
                flex: 1,
                minHeight: 0,
                overflow: 'auto',
                display: 'flex',
                flexDirection: 'column',
              }}
            >
              {loading ? (
                <div className="list" aria-busy="true" data-testid="sessions-loading">
                  {[0, 1, 2, 3].map((index) => (
                    <div key={index} className="list-row">
                      <div className="skeleton skeleton-text" style={{ width: '100%' }} />
                    </div>
                  ))}
                </div>
              ) : sessions.length === 0 ? (
                <div className="empty" data-testid="sessions-empty">
                  <p className="empty-title">{t('labels.noData')}</p>
                </div>
              ) : (
                <ul className="list" data-testid="sessions-list">
                  {sessions.map((session) => {
                    const isSelected = selectedSession?.id === session.id
                    return (
                      <li
                        key={session.id}
                        className={isSelected ? 'list-row is-selected' : 'list-row'}
                        style={rowStyle}
                        data-testid={`session-row-${session.id}`}
                      >
                        <button
                          type="button"
                          className="list-row-main"
                          aria-pressed={isSelected}
                          style={{
                            background: 'transparent',
                            border: 'none',
                            padding: 0,
                            textAlign: 'left',
                            cursor: 'pointer',
                            gap: 'var(--space-1)',
                          }}
                          onClick={() => setSelectedSession(session)}
                        >
                          <span className="list-row-title">
                            {t('settings.sessionWithId', { id: session.session_id })}
                          </span>
                          <span className="list-row-description">
                            {session.visitor_id
                              ? `${t('roles.visitor')}: ${session.visitor_id.slice(0, 12)}...`
                              : `${t('roles.visitor')}: -`}
                          </span>
                          {session.last_message && (
                            <span className="list-row-description">
                              {session.last_message}
                            </span>
                          )}
                          <span
                            className="list-row-meta"
                            style={{
                              flexWrap: 'wrap',
                              justifyContent: 'flex-start',
                              gap: 'var(--space-2)',
                            }}
                          >
                            <span className={statusBadgeClass(session.status)}>
                              {statusLabel(session.status)}
                            </span>
                            <span>{formatTime(session.updated_at || session.created_at)}</span>
                          </span>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          </section>

          {/* Conversation pane */}
          <section
            style={{
              display: isMobile && !selectedSession ? 'none' : 'flex',
              flex: 1,
              minWidth: 0,
              minHeight: isMobile ? '70vh' : 0,
              flexDirection: 'column',
              background: 'var(--surface-bg)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-lg)',
              overflow: 'hidden',
            }}
          >
            {selectedSession ? (
              <>
                <div
                  className="card-header"
                  style={{
                    margin: 0,
                    padding: 'var(--space-3) var(--space-4)',
                    borderBottom: '1px solid var(--color-border)',
                    gap: 'var(--space-3)',
                    flexWrap: 'wrap',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 'var(--space-3)',
                      flex: 1,
                      minWidth: 0,
                    }}
                  >
                    {isMobile && (
                      <button
                        type="button"
                        className="btn btn-icon"
                        aria-label={t('buttons.back')}
                        title={t('buttons.back')}
                        style={iconButtonStyle}
                        onClick={() => setSelectedSession(null)}
                      >
                        <Icon name="back" size={20} />
                      </button>
                    )}
                    <div style={{ minWidth: 0 }}>
                      <h2
                        className="card-title"
                        style={{
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {t('settings.sessionWithId', { id: selectedSession.session_id })}
                      </h2>
                      <div
                        className="list-row-meta"
                        style={{
                          flexWrap: 'wrap',
                          justifyContent: 'flex-start',
                          gap: 'var(--space-2)',
                          marginTop: 'var(--space-1)',
                        }}
                      >
                        <span
                          style={{
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            maxWidth: isMobile ? '140px' : 'none',
                          }}
                        >
                          {t('settings.visitorWithId', {
                            id: selectedSession.visitor_id,
                          })}
                        </span>
                        {(selectedSession.visitor_country ||
                          selectedSession.visitor_city) && (
                          <span className="badge badge-neutral">
                            {selectedSession.visitor_city ||
                              selectedSession.visitor_country}
                          </span>
                        )}
                        <span className={statusBadgeClass(selectedSession.status)}>
                          {statusLabel(selectedSession.status)}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="page-actions">
                    {selectedSession.status === 'active' && (
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={() => handleTakeover(selectedSession.id)}
                      >
                        <svg
                          width="16"
                          height="16"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          aria-hidden="true"
                        >
                          <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                          <circle cx="8.5" cy="7" r="4" />
                          <polyline points="17 11 19 13 23 9" />
                        </svg>
                        {!isMobile && t('labels.takeoverSession')}
                      </button>
                    )}
                    {!isMobile && (
                      <button
                        type="button"
                        className="btn btn-icon"
                        aria-label={t('knowledgeBases.actions.close')}
                        title={t('knowledgeBases.actions.close')}
                        style={iconButtonStyle}
                        onClick={() => setSelectedSession(null)}
                      >
                        <Icon name="close" size={20} />
                      </button>
                    )}
                  </div>
                </div>

                <div
                  style={{
                    flex: 1,
                    minHeight: 0,
                    overflow: 'auto',
                    padding: 'var(--space-4)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 'var(--space-3)',
                  }}
                >
                  {messages.length === 0 ? (
                    <div
                      style={{
                        margin: 'auto',
                        textAlign: 'center',
                        color: 'var(--fg-dim)',
                      }}
                    >
                      <p className="empty-title">{t('labels.noMessages')}</p>
                    </div>
                  ) : (
                    <>
                      {messages.map((msg) => {
                        const formattedAssistantContent =
                          msg.role === 'user'
                            ? null
                            : formatAssistantMessageContent(msg.content, msg.sources ?? [])

                        const isVisitor = msg.role === 'user'

                        return (
                          <div
                            key={msg.id}
                            style={{
                              display: 'flex',
                              justifyContent: isVisitor ? 'flex-end' : 'flex-start',
                            }}
                          >
                            <div
                              style={{
                                maxWidth: '75%',
                                minWidth: 0,
                                padding: 'var(--space-3) var(--space-4)',
                                borderRadius: 'var(--radius-lg)',
                                background: isVisitor
                                  ? 'var(--color-bg-tertiary)'
                                  : 'var(--color-accent-bg)',
                                border: '1px solid var(--color-border)',
                                color: 'var(--fg-strong)',
                              }}
                            >
                              <div
                                style={{
                                  fontSize: 'var(--text-xs)',
                                  fontWeight: 500,
                                  color: 'var(--fg-dim)',
                                  marginBottom: 'var(--space-1)',
                                }}
                              >
                                {isVisitor ? t('roles.visitor') : t('roles.agent')}
                              </div>
                              <div
                                style={{
                                  fontSize: 'var(--text-base)',
                                  lineHeight: 'var(--leading-relaxed)',
                                  whiteSpace: isVisitor ? 'pre-wrap' : undefined,
                                  wordBreak: 'break-word',
                                }}
                              >
                                {isVisitor ? (
                                  msg.content
                                ) : (
                                  <>
                                    <MarkdownRenderer
                                      content={
                                        formattedAssistantContent?.content ?? msg.content
                                      }
                                    />
                                    {formattedAssistantContent &&
                                      formattedAssistantContent.references.length > 0 && (
                                        <div
                                          style={{
                                            marginTop: 'var(--space-3)',
                                            paddingTop: 'var(--space-3)',
                                            borderTop:
                                              '1px solid var(--color-border)',
                                          }}
                                        >
                                          <div
                                            style={{
                                              fontSize: 'var(--text-xs)',
                                              fontWeight: 600,
                                              color: 'var(--fg-dim)',
                                              marginBottom: 'var(--space-2)',
                                            }}
                                          >
                                            {t('citations.references')}
                                          </div>
                                          <div
                                            style={{
                                              display: 'flex',
                                              flexDirection: 'column',
                                              gap: 'var(--space-2)',
                                            }}
                                          >
                                            {formattedAssistantContent.references.map(
                                              (reference) => (
                                                <a
                                                  key={reference.url}
                                                  href={reference.url}
                                                  target="_blank"
                                                  rel="noopener noreferrer"
                                                  style={{
                                                    color: 'var(--color-accent-primary)',
                                                    fontSize: 'var(--text-sm)',
                                                    fontWeight: 500,
                                                    wordBreak: 'break-word',
                                                  }}
                                                >
                                                  {reference.title}
                                                </a>
                                              ),
                                            )}
                                          </div>
                                        </div>
                                      )}
                                  </>
                                )}
                              </div>
                              <div
                                style={{
                                  fontSize: 'var(--text-xs)',
                                  color: 'var(--fg-dim)',
                                  marginTop: 'var(--space-2)',
                                }}
                              >
                                {formatTime(msg.created_at)}
                              </div>
                            </div>
                          </div>
                        )
                      })}
                      <div ref={messagesEndRef} />
                    </>
                  )}
                </div>

                {selectedSession.status === 'taken_over' && (
                  <div
                    style={{
                      display: 'flex',
                      gap: 'var(--space-2)',
                      alignItems: 'stretch',
                      padding: 'var(--space-3) var(--space-4)',
                      borderTop: '1px solid var(--color-border)',
                      background: 'var(--color-bg-panel)',
                    }}
                  >
                    <input
                      className="input"
                      type="text"
                      aria-label={t('placeholders.enterMessage')}
                      value={inputValue}
                      onChange={(e) => setInputValue(e.target.value)}
                      onKeyPress={(e) => e.key === 'Enter' && handleSend()}
                      placeholder={t('placeholders.enterMessage')}
                      disabled={sendingMessage}
                      style={{ flex: 1, minWidth: 0 }}
                    />
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={handleSend}
                      disabled={sendingMessage || !inputValue.trim()}
                    >
                      {sendingMessage ? (
                        <div className="spinner" />
                      ) : (
                        <>
                          {t('buttons.send')}
                          <svg
                            width="18"
                            height="18"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            aria-hidden="true"
                          >
                            <line x1="22" y1="2" x2="11" y2="13" />
                            <polygon points="22 2 15 22 11 13 2 9 22 2" />
                          </svg>
                        </>
                      )}
                    </button>
                  </div>
                )}
              </>
            ) : (
              <div className="empty" style={{ border: 'none', flex: 1 }}>
                <p className="empty-title">{t('labels.selectSession')}</p>
                <p className="empty-description">{t('labels.selectSessionDesc')}</p>
              </div>
            )}
          </section>
        </div>
      </div>
    </AdminLayout>
  )
}
