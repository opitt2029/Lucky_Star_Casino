import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import { useDispatch } from 'react-redux'
import { activateLeaveGuard, deactivateLeaveGuard } from '../store/slices/uiSlice'

export const GAME_LEAVE_CONFIRMED_EVENT = 'lucky-star-game-leave-confirmed'

/**
 * Shared guard for games that already accepted a bet or are resolving a round.
 * The browser listener stays mounted while the game page is mounted, then checks
 * the latest active ref at event time so quick tab-close actions do not miss it.
 */
export function useGameLeaveGuard(
  active,
  message = '遊戲尚未完成，離開後本局將視為放棄且不會派發未結算獎金。',
  options = {},
) {
  const dispatch = useDispatch()
  const activeRef = useRef(active)
  const messageRef = useRef(message)
  const onLeaveRef = useRef(options.onLeave)
  const invokedRef = useRef(false)

  activeRef.current = active
  messageRef.current = message

  useEffect(() => {
    onLeaveRef.current = options.onLeave
  }, [options.onLeave])

  const invokeLeave = useCallback((reason) => {
    if (!activeRef.current || invokedRef.current) return
    invokedRef.current = true
    onLeaveRef.current?.({ reason })
  }, [])

  useEffect(() => {
    if (active) {
      invokedRef.current = false
      dispatch(activateLeaveGuard({ message }))
    } else {
      dispatch(deactivateLeaveGuard())
    }
    return () => {
      dispatch(deactivateLeaveGuard())
    }
  }, [active, dispatch, message])

  useLayoutEffect(() => {
    const previousBeforeUnload = window.onbeforeunload
    const onBeforeUnload = (event) => {
      if (!activeRef.current) return undefined
      const warning = messageRef.current || '遊戲尚未完成，確定要離開嗎？'
      event.preventDefault()
      event.returnValue = warning
      return warning
    }
    const onPageHide = () => invokeLeave('pagehide')
    const onConfirmedNavigation = () => invokeLeave('navigation')

    window.onbeforeunload = onBeforeUnload
    window.addEventListener('beforeunload', onBeforeUnload, { capture: true })
    window.addEventListener('pagehide', onPageHide, { capture: true })
    window.addEventListener(GAME_LEAVE_CONFIRMED_EVENT, onConfirmedNavigation)
    return () => {
      window.onbeforeunload = previousBeforeUnload
      window.removeEventListener('beforeunload', onBeforeUnload, { capture: true })
      window.removeEventListener('pagehide', onPageHide, { capture: true })
      window.removeEventListener(GAME_LEAVE_CONFIRMED_EVENT, onConfirmedNavigation)
    }
  }, [invokeLeave])

  useEffect(() => {
    if (!active) return undefined

    const onPopState = () => {
      if (window.confirm(message)) {
        invokeLeave('history')
        window.removeEventListener('popstate', onPopState)
        window.history.back()
      } else {
        window.history.pushState(null, '', window.location.href)
      }
    }

    window.history.pushState(null, '', window.location.href)
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [active, invokeLeave, message])
}

export default useGameLeaveGuard
