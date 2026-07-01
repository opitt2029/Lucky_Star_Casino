import { useEffect } from 'react'
import { useDispatch } from 'react-redux'
import { activateLeaveGuard, deactivateLeaveGuard } from '../store/slices/uiSlice'

/**
 * 遊戲進行中的「離開防呆」通用 hook。
 *
 * `active` 為 true 時：
 *  - 更新 Redux leaveGuard 狀態，讓 AppShell 導航列攔截連結點擊並彈出確認視窗。
 *  - `beforeunload`（關閉分頁 / 重新整理）：跳出瀏覽器原生確認框。
 *  - `popstate`（上一頁 / 手勢返回）：原生 confirm 確認後才離開。
 *
 * @param {boolean} active  是否啟用攔截（遊戲進行中為 true）
 * @param {string}  message 確認框提示文字（AppShell 自訂視窗使用）
 */
export function useGameLeaveGuard(active, message = '遊戲進行中，確定要離開嗎？') {
  const dispatch = useDispatch()

  // 同步 Redux leaveGuard 狀態供 AppShell 使用
  useEffect(() => {
    if (active) {
      dispatch(activateLeaveGuard({ message }))
    } else {
      dispatch(deactivateLeaveGuard())
    }
    return () => {
      dispatch(deactivateLeaveGuard())
    }
  }, [active, dispatch, message])

  // 攔截 tab 關閉 / 整頁重新整理（只能用瀏覽器原生框）
  useEffect(() => {
    if (!active) return undefined
    const onBeforeUnload = (event) => {
      event.preventDefault()
      event.returnValue = ''
      return ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [active])

  // 攔截上一頁 / 手勢返回（popstate）
  useEffect(() => {
    if (!active) return undefined

    const onPopState = () => {
      if (window.confirm(message)) {
        window.removeEventListener('popstate', onPopState)
        window.history.back()
      } else {
        window.history.pushState(null, '', window.location.href)
      }
    }

    window.history.pushState(null, '', window.location.href)
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [active, message])
}

export default useGameLeaveGuard
