import { useEffect } from 'react'

/**
 * 遊戲進行中的「離開防呆」通用 hook。
 *
 * `active` 為 true 時：
 *  - `beforeunload`（關閉分頁 / 重新整理）：跳出瀏覽器原生確認框。
 *  - `popstate`（上一頁 / 手勢返回）：先攔截，`window.confirm(message)` 確認後才真正離開；
 *    取消則把哨兵歷史狀態推回，維持在當前頁，避免誤觸導航副作用
 *    （例如導回 /member 觸發 logout，或捕魚場次懸空）。
 *
 * @param {boolean} active  是否啟用攔截（遊戲進行中為 true）
 * @param {string}  message 確認框提示文字
 */
export function useGameLeaveGuard(active, message = '遊戲進行中，確定要離開嗎？') {
  useEffect(() => {
    if (!active) return undefined

    const onBeforeUnload = (event) => {
      event.preventDefault()
      // Chrome/Safari 需設定 returnValue 才會顯示原生確認框。
      event.returnValue = ''
      return ''
    }

    const onPopState = () => {
      if (window.confirm(message)) {
        // 玩家確認離開：移除攔截後再退一頁，真正離開。
        window.removeEventListener('popstate', onPopState)
        window.history.back()
      } else {
        // 取消：推回哨兵狀態，停留在當前頁。
        window.history.pushState(null, '', window.location.href)
      }
    }

    // 推一個哨兵歷史狀態，讓第一次「上一頁」落在本頁的 popstate，而非直接離開。
    window.history.pushState(null, '', window.location.href)
    window.addEventListener('beforeunload', onBeforeUnload)
    window.addEventListener('popstate', onPopState)

    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload)
      window.removeEventListener('popstate', onPopState)
    }
  }, [active, message])
}

export default useGameLeaveGuard
