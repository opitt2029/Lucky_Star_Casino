import { useCallback, useEffect, useRef, useState } from 'react'
import { Client } from '@stomp/stompjs'
import SockJS from 'sockjs-client'
import { useDispatch, useSelector } from 'react-redux'
import {
  pushNotification,
  setConnectionStatus,
  updateGameResult,
} from '../store/slices/gameSlice'

export const WS_STATUS = {
  CONNECTING: 'CONNECTING',
  CONNECTED: 'CONNECTED',
  DISCONNECTED: 'DISCONNECTED',
  RECONNECTING: 'RECONNECTING',
  ERROR: 'ERROR',
}

const NOTIFICATION_DESTINATION = '/user/queue/notifications'
const INITIAL_RECONNECT_DELAY = 1000
const MAX_RECONNECT_DELAY = 30000

function getReconnectDelay(attempt) {
  return Math.min(MAX_RECONNECT_DELAY, INITIAL_RECONNECT_DELAY * 2 ** Math.max(attempt - 1, 0))
}

function normalizeSockJsUrl(url) {
  if (url.startsWith('ws://')) return `http://${url.slice(5)}`
  if (url.startsWith('wss://')) return `https://${url.slice(6)}`
  return url
}

function parseMessageBody(body) {
  if (!body) return null
  if (typeof body !== 'string') return body
  return JSON.parse(body)
}

function toNotification(payload) {
  return {
    id: payload.id || payload.notificationId || `notice-${Date.now()}`,
    title: payload.title || (payload.type === 'GAME_RESULT' ? '遊戲結果通知' : '系統通知'),
    message: payload.message || '你有一則新通知',
    createdAt: payload.createdAt || new Date().toISOString(),
    ...payload,
  }
}

/**
 * STOMP over SockJS WebSocket hook.
 * Owns the user notification subscription and accepts extra topic subscriptions.
 *
 * @param {Object} subscriptions - Map of { destination: handlerFn }
 * @returns {{
 *   publish: (destination: string, body: unknown) => void,
 *   status: string,
 *   connected: boolean,
 *   connecting: boolean,
 *   disconnected: boolean,
 *   error: Error | null,
 *   reconnectAttempt: number
 * }}
 */
export function useWebSocket(subscriptions = {}) {
  const dispatch = useDispatch()
  const token = useSelector((state) => state.auth.accessToken)
  const wsUrl = import.meta.env.VITE_WS_URL || '/ws'
  const useMockApi = import.meta.env.VITE_USE_MOCK_API !== 'false'
  const useMockWs = import.meta.env.VITE_USE_MOCK_WS === 'true' || useMockApi
  const enableRealtimeWs = import.meta.env.VITE_ENABLE_WS === 'true'

  const clientRef = useRef(null)
  const reconnectTimerRef = useRef(null)
  const reconnectAttemptRef = useRef(0)
  const shouldReconnectRef = useRef(false)
  const subscriptionsRef = useRef(subscriptions)

  const [status, setStatus] = useState(WS_STATUS.DISCONNECTED)
  const [error, setError] = useState(null)
  const [reconnectAttempt, setReconnectAttempt] = useState(0)

  useEffect(() => {
    subscriptionsRef.current = subscriptions
  }, [subscriptions])

  const updateStatus = useCallback(
    (nextStatus, nextAttempt = reconnectAttemptRef.current) => {
      setStatus(nextStatus)
      setReconnectAttempt(nextAttempt)
      dispatch(setConnectionStatus({ status: nextStatus, reconnectAttempt: nextAttempt }))
    },
    [dispatch]
  )

  const handleNotification = useCallback(
    (payload) => {
      const notification = toNotification(payload)
      dispatch(pushNotification(notification))

      if (payload?.type === 'GAME_RESULT') {
        dispatch(updateGameResult(payload))
      }
    },
    [dispatch]
  )

  const publish = useCallback((destination, body) => {
    if (!clientRef.current?.connected) return

    clientRef.current.publish({
      destination,
      body: typeof body === 'string' ? body : JSON.stringify(body),
    })
  }, [])

  useEffect(() => {
    if (!token) {
      shouldReconnectRef.current = false
      updateStatus(WS_STATUS.DISCONNECTED, 0)
      return undefined
    }

    shouldReconnectRef.current = true
    setError(null)

    const clearReconnectTimer = () => {
      if (reconnectTimerRef.current) {
        window.clearTimeout(reconnectTimerRef.current)
        reconnectTimerRef.current = null
      }
    }

    const scheduleReconnect = (connect) => {
      if (!shouldReconnectRef.current || reconnectTimerRef.current) return

      reconnectAttemptRef.current += 1
      const nextAttempt = reconnectAttemptRef.current
      updateStatus(WS_STATUS.RECONNECTING, nextAttempt)
      reconnectTimerRef.current = window.setTimeout(() => {
        reconnectTimerRef.current = null
        connect()
      }, getReconnectDelay(nextAttempt))
    }

    const subscribeJson = (client, destination, handler) => {
      return client.subscribe(destination, (message) => {
        try {
          handler(parseMessageBody(message.body))
        } catch (parseError) {
          setError(parseError)
          updateStatus(WS_STATUS.ERROR)
        }
      })
    }

    const connect = () => {
      if (!shouldReconnectRef.current || clientRef.current?.active) return

      updateStatus(
        reconnectAttemptRef.current > 0 ? WS_STATUS.RECONNECTING : WS_STATUS.CONNECTING,
        reconnectAttemptRef.current
      )

      const client = new Client({
        webSocketFactory: () => new SockJS(normalizeSockJsUrl(wsUrl)),
        connectHeaders: {
          Authorization: `Bearer ${token}`,
        },
        reconnectDelay: 0,
        onConnect: () => {
          reconnectAttemptRef.current = 0
          setError(null)
          updateStatus(WS_STATUS.CONNECTED, 0)

          subscribeJson(client, NOTIFICATION_DESTINATION, handleNotification)

          Object.entries(subscriptionsRef.current)
            .filter(([destination]) => destination !== NOTIFICATION_DESTINATION)
            .forEach(([destination, handler]) => {
              subscribeJson(client, destination, handler)
            })
        },
        onStompError: (frame) => {
          const stompError = new Error(frame.headers?.message || 'WebSocket STOMP error')
          setError(stompError)
          updateStatus(WS_STATUS.ERROR)
          client.deactivate().finally(() => scheduleReconnect(connect))
        },
        onWebSocketError: (event) => {
          setError(event instanceof Error ? event : new Error('WebSocket connection failed'))
          updateStatus(WS_STATUS.ERROR)
        },
        onWebSocketClose: () => {
          clientRef.current = null
          if (shouldReconnectRef.current) {
            scheduleReconnect(connect)
          } else {
            updateStatus(WS_STATUS.DISCONNECTED, 0)
          }
        },
        onDisconnect: () => {
          if (!shouldReconnectRef.current) {
            updateStatus(WS_STATUS.DISCONNECTED, 0)
          }
        },
      })

      clientRef.current = client
      client.activate()
    }

    if (useMockWs) {
      updateStatus(WS_STATUS.CONNECTED, 0)
      const mockTimer = window.setInterval(() => {
        handleNotification({
          id: `notice-${Date.now()}`,
          type: 'GAME_RESULT',
          gameId: 'slot',
          win: Math.random() > 0.45,
          betAmount: 100,
          rewardAmount: 500,
          balance: 1200,
          message: '你的最新局數已完成結算',
        })
      }, 16000)

      return () => {
        shouldReconnectRef.current = false
        window.clearInterval(mockTimer)
        reconnectAttemptRef.current = 0
        updateStatus(WS_STATUS.DISCONNECTED, 0)
      }
    }

    if (!enableRealtimeWs) {
      shouldReconnectRef.current = false
      updateStatus(WS_STATUS.DISCONNECTED, 0)
      return undefined
    }

    connect()

    return () => {
      shouldReconnectRef.current = false
      clearReconnectTimer()
      reconnectAttemptRef.current = 0
      const client = clientRef.current
      clientRef.current = null
      if (client?.active) {
        client.deactivate()
      }
      updateStatus(WS_STATUS.DISCONNECTED, 0)
    }
  }, [enableRealtimeWs, handleNotification, token, updateStatus, useMockWs, wsUrl])

  return {
    publish,
    status,
    connected: status === WS_STATUS.CONNECTED,
    connecting: status === WS_STATUS.CONNECTING,
    disconnected: status === WS_STATUS.DISCONNECTED,
    error,
    reconnectAttempt,
  }
}
