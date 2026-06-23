import { useEffect } from 'react'
import { soundEngine } from '../casino-fx/sound/SoundEngine'

/**
 * 遊戲離開確認視窗。
 *
 * 由 AppShell 在 leaveGuard.pendingPath 有值時渲染；
 * onConfirm 實際執行導航，onCancel 清除 pendingPath。
 */
export default function LeaveGameModal({ open, message, onConfirm, onCancel }) {
  useEffect(() => {
    if (open) soundEngine.play('click')
  }, [open])

  if (!open) return null

  const handleLeave = () => {
    soundEngine.play('click')
    onConfirm?.()
  }

  const handleStay = () => {
    soundEngine.play('click')
    onCancel?.()
  }

  return (
    <div
      className="fixed inset-0 z-[60] grid place-items-center bg-red-950/80 px-4 py-6 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="leave-game-title"
    >
      <div className="luxury-panel w-full max-w-sm rounded p-6 shadow-2xl">
        <div className="mb-1 text-xs font-black uppercase tracking-[0.25em] text-yellow-200/60">
          Leave Game
        </div>
        <h2 id="leave-game-title" className="brand-title text-xl font-black text-yellow-100">
          確定要離開遊戲？
        </h2>

        <p className="mt-3 text-sm leading-6 text-yellow-100/80">
          {message || '遊戲進行中，確定要離開嗎？'}
        </p>

        <div className="mt-2 rounded border border-red-400/30 bg-red-500/10 px-3 py-2 text-xs font-bold text-red-200">
          離開後將無法退回已下注金額
        </div>

        <div className="mt-5 grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={handleStay}
            className="gold-button rounded px-4 py-3 text-sm font-black transition"
            autoFocus
          >
            繼續遊戲
          </button>
          <button
            type="button"
            onClick={handleLeave}
            className="red-gold-button rounded px-4 py-3 text-sm font-black transition"
          >
            確認離開
          </button>
        </div>
      </div>
    </div>
  )
}
