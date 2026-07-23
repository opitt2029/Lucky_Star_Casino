import { useEffect, useId, useRef, useState } from 'react'
import './infoHint.css'

/**
 * 區塊說明標誌：一顆驚嘆號小圓鈕，點下去就地展開一張說明卡。
 *
 * 為什麼不沿用 GameRuleCard？
 * GameRuleCard 是 createPortal(..., document.body) 的全頁 modal。全螢幕時
 * 瀏覽器只渲染「進入全螢幕的那個元素及其子孫」，掛在 document.body 底下的
 * portal 不在那棵子樹裡，會整個看不見（老虎機全螢幕之所以把規則卡藏起來就是
 * 這個原因）。所以這裡刻意就地渲染 + 絕對定位，全螢幕與一般頁面都能用。
 *
 * @param {string} title    說明卡標題，通常就是該區塊的名稱
 * @param {string} children 說明內文
 * @param {string} align    說明卡對齊方向：'left'（預設）或 'right'。
 *                          靠近畫面右緣的區塊用 'right'，避免卡片被切出可視範圍。
 */
export default function InfoHint({ title, children, align = 'left', label }) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef(null)
  const panelId = useId()
  const accessibleLabel = label || `${title}說明`

  useEffect(() => {
    if (!open) return undefined

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') setOpen(false)
    }
    // 點到說明卡外面就收起來；用 pointerdown 而非 click，
    // 才不會跟按鈕自己的 onClick 打架（click 會在 pointerdown 之後才觸發）。
    const handlePointerDown = (event) => {
      if (!wrapRef.current?.contains(event.target)) setOpen(false)
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('pointerdown', handlePointerDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('pointerdown', handlePointerDown)
    }
  }, [open])

  return (
    <span className="info-hint" ref={wrapRef}>
      <button
        type="button"
        className="info-hint__button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={accessibleLabel}
        title={accessibleLabel}
      >
        <span aria-hidden="true">!</span>
      </button>

      {open && (
        <span
          id={panelId}
          role="tooltip"
          className={['info-hint__panel', `info-hint__panel--${align}`].join(' ')}
        >
          <strong className="info-hint__title">{title}</strong>
          <span className="info-hint__body">{children}</span>
        </span>
      )}
    </span>
  )
}
