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
  const isMountedRef = useRef(true)

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

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsUrl = `${protocol}//${window.location.host}/api/v1/ws/admin?token=${token}`

    wsRef.current = new WebSocket(wsUrl)

    wsRef.current.onopen = () => {
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
      console.error('WebSocket error:', error)
    }

    wsRef.current.onclose = (event) => {
      console.log('WebSocket disconnected (code: %d)', event.code)
      if (!isMountedRef.current) return
      // Do not reconnect after intentional close (cleanup in useEffect return).
      if (event.code === 1000 || event.code === 1001) return

      reconnectTimeoutRef.current = setTimeout(() => {
        console.log('Reconnecting...')
        connectWebSocket()
      }, 5000)
    }
  }, [sessionId, token])

  useEffect(() => {
    isMountedRef.current = true
    void fetchMessages()
    connectWebSocket()

    return () => {
      isMountedRef.current = false
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
    <div style={{ padding: '20px', height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <header style={{ marginBottom: '20px' }}>
        <button onClick={() => navigate('/sessions')}>{t('buttons.back')}</button>
        <h1>{t('settings.sessionWithId')} #{sessionId}</h1>
      </header>

      <div style={{ flex: 1, overflowY: 'auto', marginBottom: '20px' }}>
        {messages.map((msg) => (
          <div
            key={msg.id}
            style={{
              padding: '10px',
              margin: '10px 0',
              backgroundColor: msg.role === 'user' ? '#f0f0f0' : '#e3f2fd',
              borderRadius: '8px',
            }}
          >
            <strong>{msg.role === 'user' ? t('roles.visitor') : t('roles.agent')}: </strong>
            {msg.content}
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      <div style={{ display: 'flex', gap: '10px' }}>
        <input
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyPress={(e) => e.key === 'Enter' && handleSend()}
          placeholder={t('placeholders.enterMessage')}
          style={{ flex: 1, padding: '10px' }}
        />
        <button onClick={handleSend}>{t('buttons.send')}</button>
      </div>
    </div>
  )
}
