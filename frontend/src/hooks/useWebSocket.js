import { useEffect, useRef, useCallback } from 'react'
import { Client } from '@stomp/stompjs'
import SockJS from 'sockjs-client'
import { useSelector } from 'react-redux'

/**
 * WebSocket hook using STOMP over SockJS.
 * Connects when the player is authenticated; disconnects on cleanup.
 *
 * @param {Object} subscriptions - Map of { destination: handlerFn }
 * @returns {{ publish: (destination, body) => void }}
 */
export function useWebSocket(subscriptions = {}) {
  const clientRef = useRef(null)
  const token = useSelector((state) => state.auth.accessToken)
  const wsUrl = import.meta.env.VITE_WS_URL || 'ws://localhost:8080/ws'

  const publish = useCallback((destination, body) => {
    if (clientRef.current?.connected) {
      clientRef.current.publish({
        destination,
        body: JSON.stringify(body),
      })
    }
  }, [])

  useEffect(() => {
    if (!token) return

    const client = new Client({
      webSocketFactory: () => new SockJS(wsUrl.replace(/^ws/, 'http')),
      connectHeaders: {
        Authorization: `Bearer ${token}`,
      },
      reconnectDelay: 5000,
      onConnect: () => {
        Object.entries(subscriptions).forEach(([destination, handler]) => {
          client.subscribe(destination, (message) => {
            try {
              handler(JSON.parse(message.body))
            } catch {
              handler(message.body)
            }
          })
        })
      },
    })

    client.activate()
    clientRef.current = client

    return () => {
      client.deactivate()
    }
    // subscriptions intentionally excluded — callers should memoize handlers
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, wsUrl])

  return { publish }
}
