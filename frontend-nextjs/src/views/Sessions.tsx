'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useParams, useSearchParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import AdminLayout from '../components/AdminLayout'
import HelpTooltip from '../components/HelpTooltip'
import { Icon } from '../components/Icon'
import { MarkdownRenderer } from '../components/MarkdownRenderer'
import { useIsMobile } from '../hooks/useMediaQuery'
import { WS_BASE_URL } from '../lib/env'
import { api } from '../services/api'
import { formatAssistantMessageContent } from '../utils/citations'

interface Session {
  id: string
  session_id: string
  visitor_id?: string
  visitor_country?: string
  visitor_city?: string
  status: string
  /** #43: who answers next. `taken_over` implies `human`. */
  mode?: 'ai' | 'human'
  human_replied_at?: string | null
  message_count: number
  created_at: string
  updated_at?: string
  last_message?: string
}

/** #43: every state the backend may store, including the legacy `closed`. */
type SessionStatus = 'active' | 'taken_over' | 'resolved' | 'closed' | 'paused'

/** The four explicit actions plus reopen (#43). */
type SessionAction = 'reply' | 'takeover' | 'release' | 'resolve' | 'reopen'

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
  /** #42: retrieval signal 0..1, or null when nothing was retrieved. */
  confidence?: number | null
  /** #42: true when the answer did not really answer (see answer_quality.py). */
  is_unanswered?: boolean
  created_at: string
}

/** Below this an answer is weak enough to badge in the transcript (#42). */
const LOW_CONFIDENCE_THRESHOLD = 0.5

/** The confidence chip: a percentage in the mono face, or an em dash. */
function confidenceLabel(confidence: number | null | undefined): string {
  if (typeof confidence !== 'number') return '—'
  return `${Math.round(confidence * 100)}%`
}

export default function Sessions() {
  const { t } = useTranslation('common')
  const { agentId } = useParams<{ agentId?: string }>()
  const [searchParams] = useSearchParams()
  const { token } = useAuth()
  const isMobile = useIsMobile()
  const [sessions, setSessions] = useState<Session[]>([])
  const [selectedSession, setSelectedSession] = useState<Session | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [filter, setFilter] = useState<
    'all' | 'active' | 'taken_over' | 'resolved' | 'closed'
  >('all')
  const [keyword, setKeyword] = useState('')
  const [inputValue, setInputValue] = useState('')
  const [loading, setLoading] = useState(false)
  const [sendingMessage, setSendingMessage] = useState(false)
  // #43: the Reply composer is a separate, explicit action from Take over.
  const [replyOpen, setReplyOpen] = useState(false)
  const [replyDraft, setReplyDraft] = useState('')
  const [pendingAction, setPendingAction] = useState<SessionAction | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  // Issue item 4: correct one assistant answer and turn it into a curated pair.
  const [reviseOpen, setReviseOpen] = useState(false)
  const [reviseDraft, setReviseDraft] = useState('')
  const [reviseSaving, setReviseSaving] = useState(false)
  const [reviseError, setReviseError] = useState<string | null>(null)
  const [reviseSaved, setReviseSaved] = useState<string | null>(null)
  // #42: the session-list quality filters and the "Add to Q&A" write-back.
  // `?unanswered=1` is the dashboard tile's entry point into the same filter.
  const [unansweredOnly, setUnansweredOnly] = useState(
    searchParams.get('unanswered') === '1',
  )
  const [qaFromMessageSaving, setQaFromMessageSaving] = useState<number | null>(null)
  const [qaFromMessageSaved, setQaFromMessageSaved] = useState<string | null>(null)
  const [qaFromMessageError, setQaFromMessageError] = useState<string | null>(null)
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
      // #42: "未答问题 / Unanswered" narrows the list to sessions with at
      // least one assistant message the quality rule flagged.
      const unansweredParam = unansweredOnly ? '&unanswered=true' : ''

      const response = await fetch(
        `/api/v1/admin/sessions?skip=0&limit=50${agentId ? `&agent_id=${agentId}` : ''}${statusParam}${keywordParam}${unansweredParam}`,
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
  }, [filter, keyword, token, unansweredOnly, agentId])

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

  /**
   * #43: the four explicit actions. Reply never changes `status`; takeover mutes
   * the bot; release hands it back; resolve marks the conversation handled and
   * is deliberately distinct from the inactivity `closed`.
   */
  const runSessionAction = useCallback(
    async (sessionId: string, action: SessionAction, message?: string) => {
      setPendingAction(action)
      setActionError(null)
      try {
        let response: Response
        if (action === 'reply') {
          response = await fetch(`/api/v1/admin/sessions/${sessionId}/reply`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ message }),
          })
        } else if (action === 'takeover') {
          response = await fetch(`/api/v1/admin/sessions/${sessionId}/takeover`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}` },
          })
        } else {
          response = await fetch(`/api/v1/admin/sessions/${sessionId}/${action}`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}` },
          })
        }

        if (!response.ok) {
          setActionError(t(`handoff.errors.${action}`))
          return false
        }

        const body = await response.json()
        // Every action route returns the session, so the row re-renders from the
        // response instead of guessing the new state.
        const updated = body?.session
        if (updated) {
          setSelectedSession((current) =>
            current && current.id === sessionId
              ? {
                  ...current,
                  status: updated.status ?? current.status,
                  mode: updated.mode ?? current.mode,
                  human_replied_at:
                    updated.human_replied_at ?? current.human_replied_at,
                }
              : current,
          )
        }

        await fetchSessions()
        if (action === 'reply') {
          await fetchMessages(sessionId)
          setReplyDraft('')
          setReplyOpen(false)
        }
        if (action === 'resolve' || action === 'reopen') {
          setReplyOpen(false)
        }
        return true
      } catch (err) {
        console.error(`Failed to ${action} session:`, err)
        setActionError(t(`handoff.errors.${action}`))
        return false
      } finally {
        setPendingAction(null)
      }
    },
    [fetchMessages, fetchSessions, t, token],
  )

  const handleTakeover = (sessionId: string) => {
    void runSessionAction(sessionId, 'takeover')
  }

  const handleReply = async () => {
    if (!replyDraft.trim() || !selectedSession) return
    await runSessionAction(selectedSession.id, 'reply', replyDraft)
  }

  /**
   * The in-transcript composer keeps using `/admin/sessions/send` (its route and
   * response shape are unchanged); #43 only removed the forced takeover.
   */
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
      await fetchSessions()
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

  /**
   * Revise answer (issue item 4): the operator's correction is posted as a
   * curated pair on the agent's bound KB, so the *next* identical question is
   * answered from it with no reindex.
   */
  const openRevise = (content: string) => {
    setReviseDraft(content)
    setReviseError(null)
    setReviseSaved(null)
    setReviseOpen(true)
  }

  const closeRevise = () => {
    setReviseOpen(false)
    setReviseError(null)
  }

  const handleReviseSubmit = async () => {
    if (!selectedSession || reviseSaving) return
    const answer = reviseDraft.trim()
    if (!answer) {
      setReviseError(t('reviseAnswer.answerRequired'))
      return
    }
    setReviseSaving(true)
    setReviseError(null)
    try {
      const result = await api.reviseAnswer(selectedSession.id, answer)
      setReviseOpen(false)
      setReviseSaved(
        result.replaced
          ? t('reviseAnswer.savedReplaced')
          : t('reviseAnswer.saved'),
      )
    } catch (err) {
      setReviseError(
        err instanceof Error ? err.message : t('reviseAnswer.errors.saveFailed'),
      )
    } finally {
      setReviseSaving(false)
    }
  }

  /**
   * "Add to Q&A" (#42): one click turns a triaged answer into a curated pair.
   * It calls the existing `POST /admin/qa/from-message/{id}` — the backend
   * already derives the question from the preceding user message, so the action
   * needs no input. Adding the pair *is* the triage decision, so the row is then
   * dismissed out of the unanswered queue (the message itself is untouched).
   */
  const handleAddToQa = async (messageId: number) => {
    if (qaFromMessageSaving !== null) return
    setQaFromMessageSaving(messageId)
    setQaFromMessageError(null)
    setQaFromMessageSaved(null)
    try {
      const result = await api.addQaFromMessage(messageId)
      setQaFromMessageSaved(result.qa_item.question)
      setMessages((current) =>
        current.map((message) =>
          message.id === messageId
            ? { ...message, is_unanswered: false }
            : message,
        ),
      )
    } catch (err) {
      setQaFromMessageError(
        err instanceof Error
          ? err.message
          : t('unanswered.errors.addFailed'),
      )
      return
    } finally {
      setQaFromMessageSaving(null)
    }

    // The pair exists, so the queue row is done. A dismissal failure is
    // cosmetic — the message stays answered and the operator can retry — so it
    // is logged rather than turned into an error toast over a success.
    try {
      await api.dismissUnanswered(messageId)
      void fetchSessions()
    } catch (err) {
      console.error('Failed to dismiss the unanswered row:', err)
    }
  }

  const rowStyle = isMobile
    ? { flexDirection: 'column' as const, alignItems: 'stretch' as const }
    : undefined

  const iconButtonStyle = isMobile
    ? { minWidth: 44, minHeight: 44 }
    : undefined

  /**
   * #43: `resolved` reads differently from a timeout `closed` — a distinct
   * design-system badge variant, never a colour literal. Unknown/legacy values
   * fall back to the neutral variant so an old row still renders.
   */
  const statusBadgeClass = (status: string): string => {
    switch (status) {
      case 'active':
        return 'badge badge-success'
      case 'taken_over':
        return 'badge badge-warning'
      case 'resolved':
        return 'badge badge-info'
      case 'closed':
        return 'badge badge-neutral'
      case 'paused':
        return 'badge badge-neutral'
      default:
        return 'badge badge-neutral'
    }
  }

  const statusLabel = (status: string): string => {
    const key: Record<string, string> = {
      active: 'status.active',
      taken_over: 'status.takenOver',
      resolved: 'status.resolved',
      closed: 'status.ended',
      paused: 'status.paused',
    }
    return t(key[status] ?? 'status.unknown')
  }

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
          <div className="page-actions" style={{ flexWrap: 'wrap' }}>
            {(
              ['all', 'active', 'taken_over', 'resolved', 'closed'] as const
            ).map((status) => (
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
            {/* #42: the triage filter. A chip, not a status: it composes with
             * the status buttons instead of replacing them. */}
            <button
              type="button"
              className={unansweredOnly ? 'btn btn-primary' : 'btn btn-secondary'}
              data-testid="sessions-filter-unanswered"
              aria-pressed={unansweredOnly}
              onClick={() => setUnansweredOnly((value) => !value)}
            >
              {t('unanswered.filter')}
            </button>
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
                  <div className="page-actions" style={{ flexWrap: 'wrap' }}>
                    {/* #43: four explicit actions. Reply answers one question
                     * without muting the bot; takeover mutes it; release hands
                     * it back; resolve closes the question (not the session
                     * timeout). A resolved row offers Reopen instead. */}
                    {selectedSession.status !== 'resolved' &&
                      selectedSession.status !== 'closed' && (
                        <>
                          <button
                            type="button"
                            className="btn btn-secondary"
                            data-testid="session-action-reply"
                            disabled={pendingAction !== null}
                            onClick={() => {
                              setReplyOpen((open) => !open)
                              setActionError(null)
                            }}
                          >
                            {t('handoff.reply')}
                          </button>
                          {selectedSession.status === 'active' &&
                            selectedSession.mode !== 'human' && (
                              <button
                                type="button"
                                className="btn btn-secondary"
                                data-testid="session-action-takeover"
                                disabled={pendingAction !== null}
                                onClick={() => handleTakeover(selectedSession.id)}
                              >
                                {t('handoff.takeover')}
                              </button>
                            )}
                          {selectedSession.mode === 'human' && (
                            <button
                              type="button"
                              className="btn btn-secondary"
                              data-testid="session-action-release"
                              disabled={pendingAction !== null}
                              onClick={() =>
                                void runSessionAction(selectedSession.id, 'release')
                              }
                            >
                              {t('handoff.release')}
                            </button>
                          )}
                          <button
                            type="button"
                            className="btn btn-primary"
                            data-testid="session-action-resolve"
                            disabled={pendingAction !== null}
                            onClick={() =>
                              void runSessionAction(selectedSession.id, 'resolve')
                            }
                          >
                            {t('handoff.resolve')}
                          </button>
                        </>
                      )}
                    {selectedSession.status === 'resolved' && (
                      <button
                        type="button"
                        className="btn btn-primary"
                        data-testid="session-action-reopen"
                        disabled={pendingAction !== null}
                        onClick={() =>
                          void runSessionAction(selectedSession.id, 'reopen')
                        }
                      >
                        {t('handoff.reopen')}
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
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'space-between',
                                  flexWrap: 'wrap',
                                  gap: 'var(--space-2)',
                                  marginTop: 'var(--space-2)',
                                }}
                              >
                                <span
                                  style={{
                                    fontSize: 'var(--text-xs)',
                                    color: 'var(--fg-dim)',
                                  }}
                                >
                                  {formatTime(msg.created_at)}
                                </span>
                                {/* #42: a weak answer carries its own percentage, in mono so the
                                 * column of scores lines up. NULL means "no retrieval signal"
                                 * and stays an em dash, never 0%. */}
                                {!isVisitor &&
                                  typeof msg.confidence === 'number' &&
                                  msg.confidence < LOW_CONFIDENCE_THRESHOLD && (
                                  <span
                                    className="badge badge-warning"
                                    data-testid={`message-confidence-${msg.id}`}
                                    aria-label={t('unanswered.confidenceLabel', {
                                      value: confidenceLabel(msg.confidence),
                                    })}
                                    title={t('unanswered.confidenceLabel', {
                                      value: confidenceLabel(msg.confidence),
                                    })}
                                  >
                                    <span className="mono">{confidenceLabel(msg.confidence)}</span>
                                  </span>
                                )}
                                {/* #42: one click turns the turn into a curated pair. The
                                 * backend derives the question from the preceding user
                                 * message, so the action needs no input. */}
                                {!isVisitor && msg.is_unanswered && (
                                  <button
                                    type="button"
                                    className="btn btn-ghost"
                                    data-testid={`add-to-qa-${msg.id}`}
                                    aria-label={t('unanswered.addToQaLabel', {
                                      preview: msg.content.slice(0, 40),
                                    })}
                                    title={t('unanswered.addToQaLabel', {
                                      preview: msg.content.slice(0, 40),
                                    })}
                                    disabled={qaFromMessageSaving === msg.id}
                                    aria-busy={qaFromMessageSaving === msg.id}
                                    onClick={() => void handleAddToQa(msg.id)}
                                  >
                                    {qaFromMessageSaving === msg.id ? (
                                      <div
                                        className="spinner"
                                        style={{ width: '14px', height: '14px' }}
                                      />
                                    ) : null}
                                    {t('unanswered.addToQa')}
                                  </button>
                                )}
                                {!isVisitor && (
                                  <button
                                    type="button"
                                    className="btn btn-ghost"
                                    data-testid={`revise-answer-${msg.id}`}
                                    aria-label={t('reviseAnswer.actionLabel', {
                                      preview: msg.content.slice(0, 40),
                                    })}
                                    title={t('reviseAnswer.actionLabel', {
                                      preview: msg.content.slice(0, 40),
                                    })}
                                    onClick={() => openRevise(msg.content)}
                                  >
                                    {t('reviseAnswer.action')}
                                  </button>
                                )}
                              </div>
                            </div>
                          </div>
                        )
                      })}
                      <div ref={messagesEndRef} />
                    </>
                  )}
                </div>

                {/* #43: the Reply composer — answering one question without a
                 * takeover. It posts `/reply`, which sets mode="human" and
                 * leaves `status` alone. */}
                {replyOpen &&
                  selectedSession.status !== 'resolved' &&
                  selectedSession.status !== 'closed' && (
                    <div
                      data-testid="session-reply-composer"
                      style={{
                        display: 'flex',
                        gap: 'var(--space-2)',
                        alignItems: 'stretch',
                        flexWrap: isMobile ? 'wrap' : 'nowrap',
                        padding: 'var(--space-3) var(--space-4)',
                        borderTop: '1px solid var(--color-border)',
                        background: 'var(--color-bg-panel)',
                      }}
                    >
                      <input
                        className="input"
                        type="text"
                        aria-label={t('handoff.replyPlaceholder')}
                        value={replyDraft}
                        onChange={(e) => setReplyDraft(e.target.value)}
                        onKeyPress={(e) => {
                          if (e.key === 'Enter') void handleReply()
                        }}
                        placeholder={t('handoff.replyPlaceholder')}
                        disabled={pendingAction === 'reply'}
                        style={{ flex: 1, minWidth: 0 }}
                      />
                      <button
                        type="button"
                        className="btn btn-primary"
                        data-testid="session-reply-send"
                        onClick={() => void handleReply()}
                        disabled={
                          pendingAction === 'reply' || !replyDraft.trim()
                        }
                      >
                        {pendingAction === 'reply' ? (
                          <div className="spinner" />
                        ) : (
                          t('handoff.sendReply')
                        )}
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        onClick={() => {
                          setReplyOpen(false)
                          setReplyDraft('')
                        }}
                      >
                        {t('buttons.cancel')}
                      </button>
                    </div>
                  )}

                {actionError && (
                  <p
                    role="alert"
                    className="field-error"
                    data-testid="session-action-error"
                    style={{ margin: 0, padding: 'var(--space-2) var(--space-4)' }}
                  >
                    {actionError}
                  </p>
                )}

                {(selectedSession.status === 'taken_over' ||
                  selectedSession.mode === 'human') && (
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

        {/* #42: the created pair is echoed inline — the backend derived the
         * question from the preceding user message, so this is the confirmation
         * that a real question landed in the index. */}
        {(qaFromMessageSaved || qaFromMessageError) && (
          <div
            className={
              qaFromMessageError ? 'toast toast-error' : 'toast toast-success'
            }
            role={qaFromMessageError ? 'alert' : 'status'}
            aria-live="polite"
            data-testid="add-to-qa-result"
            style={{
              position: 'fixed',
              right: 'var(--space-6)',
              bottom: 'var(--space-6)',
              zIndex: 70,
            }}
          >
            <span className="toast-description">
              {qaFromMessageError ? (
                qaFromMessageError
              ) : (
                <>
                  {t('unanswered.addedToQa')}
                  {qaFromMessageSaved ? (
                    <span className="mono"> {qaFromMessageSaved}</span>
                  ) : null}
                </>
              )}
            </span>
            <button
              type="button"
              className="btn btn-ghost btn-icon"
              aria-label={t('knowledgeBases.actions.close')}
              title={t('knowledgeBases.actions.close')}
              onClick={() => {
                setQaFromMessageSaved(null)
                setQaFromMessageError(null)
              }}
            >
              <Icon name="close" size={16} />
            </button>
          </div>
        )}

        {reviseSaved && (
          <div
            className="toast toast-success"
            role="status"
            aria-live="polite"
            data-testid="revise-answer-saved"
            style={{ position: 'fixed', right: 'var(--space-6)', bottom: 'var(--space-6)', zIndex: 70 }}
          >
            <span className="toast-description">{reviseSaved}</span>
            <button
              type="button"
              className="btn btn-ghost btn-icon"
              aria-label={t('knowledgeBases.actions.close')}
              title={t('knowledgeBases.actions.close')}
              onClick={() => setReviseSaved(null)}
            >
              <Icon name="close" size={16} />
            </button>
          </div>
        )}

        {reviseOpen && (
          <div
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 9999,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 'var(--space-4)',
              overflowY: 'auto',
            }}
            onClick={closeRevise}
          >
            <div className="sheet-backdrop" aria-hidden="true" />
            <div
              className="sheet"
              role="dialog"
              aria-modal="true"
              aria-labelledby="revise-answer-title"
              data-testid="revise-answer-sheet"
              style={{
                position: 'relative',
                maxWidth: '560px',
                width: '100%',
                minWidth: 0,
                maxHeight: 'calc(100vh - var(--space-8))',
                borderRadius: 'var(--radius-lg)',
              }}
              onClick={(event) => event.stopPropagation()}
            >
              <div className="sheet-header">
                <div style={{ minWidth: 0 }}>
                  <h2 id="revise-answer-title" className="card-title">
                    {t('reviseAnswer.title')}
                  </h2>
                  <p className="field-hint" style={{ marginTop: 'var(--space-1)' }}>
                    {t('reviseAnswer.description')}
                  </p>
                </div>
                <button
                  type="button"
                  className="btn btn-icon"
                  aria-label={t('knowledgeBases.actions.close')}
                  title={t('knowledgeBases.actions.close')}
                  onClick={closeRevise}
                >
                  <Icon name="close" size={16} />
                </button>
              </div>

              <div className="sheet-body">
                <div className="field" style={{ marginBottom: 0 }}>
                  <label className="field-label" htmlFor="revise-answer-text">
                    {t('reviseAnswer.label')}
                  </label>
                  <textarea
                    id="revise-answer-text"
                    className="input textarea"
                    value={reviseDraft}
                    onChange={(event) => {
                      setReviseDraft(event.target.value);
                      setReviseError(null);
                    }}
                    rows={6}
                    placeholder={t('reviseAnswer.placeholder')}
                  />
                  {reviseError && (
                    <p role="alert" className="field-error">
                      {reviseError}
                    </p>
                  )}
                </div>
              </div>

              <div className="sheet-footer">
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={closeRevise}
                >
                  {t('buttons.cancel')}
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={handleReviseSubmit}
                  disabled={reviseSaving}
                  aria-busy={reviseSaving}
                >
                  {reviseSaving ? (
                    <div className="spinner" style={{ width: '14px', height: '14px' }} />
                  ) : null}
                  {t('reviseAnswer.submit')}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </AdminLayout>
  )
}
