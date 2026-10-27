'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useTranslation } from 'react-i18next'

interface Message {
  id: number
  role: string
  content: string
  created_at: string
}

/**
 * Read-along admin chat view for one session (`/chat/:sessionId`).
 *
 * Restyle (spec §20): the page is now the shared `page` scaffold and the
 * bubbles use token surfaces instead of the old hard-coded grey / blue fills.
 * The WebSocket connect/reconnect/close lifecycle, the message list state and
 * the scroll behaviour are untouched.
 */
export default function Chat() {
  const { t } = useTranslation('common')
  const { sessionId } = useParams<{ sessionId: string }>()
  const navigate = useNavigate()
  const { token } = useAuth()
  const [messages, setMessages] = useState<Message[]>([])
  const [inputValue, setInputValue] = useState('')
  const wsRef = useRef<WebSocket | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const reconnectAttemptRef = useRef(0)
  const isMountedRef = useRef(true)
  const isConnectingRef = useRef(false)

  const NORMAL_CLOSE_CODE = 1000
  const GOING_AWAY_CLOSE_CODE = 1001
  const MAX_RECONNECT_DELAY_MS = 30000
  const MAX_RECONNECT_ATTEMPT = 5

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  const fetchMessages = useCallback(async () => {
    if (!sessionId || !token) return

    try {
      const response = await fetch(`/api/v1/admin/sessions/${sessionId}/messages`, {
        headers: { Authorization: `Bearer ${token}` },
      })

      if (response.ok) {
        const data = await response.json()
        setMessages(data)
      } else {
        console.error('Failed to fetch messages:', response.statusText)
      }
    } catch (error) {
      console.error('Error fetching messages:', error)
    }
  }, [sessionId, token])

  const connectWebSocket = useCallback(() => {
    if (!token) return
    if (isConnectingRef.current) return
    if (wsRef.current && (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING)) {
      return
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsUrl = `${protocol}//${window.location.host}/api/v1/ws/admin?token=${token}`

    isConnectingRef.current = true
    wsRef.current = new WebSocket(wsUrl)

    wsRef.current.onopen = () => {
      isConnectingRef.current = false
      reconnectAttemptRef.current = 0
      console.log('WebSocket connected')
    }

    wsRef.current.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)

        if (data.type === 'new_message' && (data.sessionDbId || data.sessionId) === sessionId) {
          setMessages((prev) => [
            ...prev,
            {
              id: Date.now(),
              role: data.role,
              content: data.content,
              created_at: new Date().toISOString(),
            },
          ])
        }
      } catch (error) {
        console.error('Error parsing WebSocket message:', error)
      }
    }

    wsRef.current.onerror = (error) => {
      isConnectingRef.current = false
      console.error('WebSocket error:', error)
    }

    wsRef.current.onclose = (event) => {
      isConnectingRef.current = false
      console.log('WebSocket disconnected (code: %d)', event.code)
      if (!isMountedRef.current) return
      // Normal closure or policy close should not trigger reconnect.
      if (event.code === NORMAL_CLOSE_CODE || event.code === GOING_AWAY_CLOSE_CODE) return

      const clampedAttempt = Math.min(reconnectAttemptRef.current, MAX_RECONNECT_ATTEMPT)
      const delay = Math.min(MAX_RECONNECT_DELAY_MS, 1000 * (2 ** clampedAttempt))
      reconnectAttemptRef.current = Math.min(reconnectAttemptRef.current + 1, MAX_RECONNECT_ATTEMPT)
      reconnectTimeoutRef.current = setTimeout(() => {
        console.log('Reconnecting...')
        connectWebSocket()
      }, delay)
    }
  }, [sessionId, token])

  useEffect(() => {
    isMountedRef.current = true
    void fetchMessages()
    connectWebSocket()

    return () => {
      isMountedRef.current = false
      isConnectingRef.current = false
      if (wsRef.current) {
        wsRef.current.close()
        wsRef.current = null
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current)
        reconnectTimeoutRef.current = null
      }
    }
  }, [connectWebSocket, fetchMessages])

  useEffect(() => {
    scrollToBottom()
  }, [messages, scrollToBottom])

  const handleSend = async () => {
    if (!inputValue.trim()) return

    try {
      const response = await fetch('/api/v1/admin/sessions/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          session_id: sessionId,
          content: inputValue,
        }),
      })

      if (!response.ok) {
        console.error('Failed to send message:', response.statusText)
        alert(t('errors.sendFailed'))
        return
      }

      setInputValue('')
      await fetchMessages()
    } catch (error) {
      console.error('Error sending message:', error)
      alert(t('errors.sendFailed'))
    }
  }

  return (
    <div
      className="page"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        minWidth: 0,
      }}
    >
      <header className="page-header" style={{ flexShrink: 0 }}>
        <div style={{ minWidth: 0 }}>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => navigate('/sessions')}
            style={{ marginBottom: 'var(--space-2)', paddingLeft: 0 }}
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
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
            {t('buttons.back')}
          </button>
          <h1 className="page-title">
            {t('settings.sessionWithId', { id: sessionId })}
          </h1>
        </div>
      </header>

      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-3)',
          paddingBottom: 'var(--space-3)',
        }}
      >
        {messages.length === 0 ? (
          <div className="empty">
            <p className="empty-title">{t('labels.noMessages')}</p>
          </div>
        ) : (
          messages.map((msg) => {
            const isUser = msg.role === 'user'
            return (
              <div
                key={msg.id}
                style={{
                  display: 'flex',
                  justifyContent: isUser ? 'flex-end' : 'flex-start',
                }}
              >
                <div
                  style={{
                    maxWidth: '85%',
                    minWidth: 0,
                    padding: 'var(--space-3) var(--space-4)',
                    borderRadius: 'var(--radius-lg)',
                    background: isUser
                      ? 'var(--color-bg-tertiary)'
                      : 'var(--color-accent-bg)',
                    border: '1px solid var(--color-border)',
                    color: 'var(--fg-strong)',
                    fontSize: 'var(--text-sm)',
                    lineHeight: 'var(--leading-relaxed)',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                  }}
                >
                  <span
                    style={{
                      display: 'block',
                      marginBottom: 'var(--space-1)',
                      fontSize: 'var(--text-xs)',
                      fontWeight: 500,
                      color: 'var(--fg-dim)',
                    }}
                  >
                    {isUser ? t('roles.visitor') : t('roles.agent')}
                  </span>
                  {msg.content}
                </div>
              </div>
            )
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      <div
        style={{
          display: 'flex',
          gap: 'var(--space-2)',
          alignItems: 'stretch',
          paddingTop: 'var(--space-3)',
          borderTop: '1px solid var(--color-border)',
          flexShrink: 0,
        }}
      >
        <input
          type="text"
          className="input"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyPress={(e) => e.key === 'Enter' && handleSend()}
          placeholder={t('placeholders.enterMessage')}
          style={{ flex: 1, minWidth: 0 }}
        />
        <button
          type="button"
          className="btn btn-primary"
          onClick={handleSend}
          disabled={!inputValue.trim()}
        >
          {t('buttons.send')}
        </button>
      </div>
    </div>
  )
}
