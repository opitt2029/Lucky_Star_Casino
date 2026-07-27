import { useEffect, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
import { getAvatarPresetForPlayer } from '../data/avatarPresets'
import RankPlayerAvatar from './RankPlayerAvatar'

const gameLabels = { SLOT: 'Slot', BACCARAT: 'Baccarat', FISHING: 'Fishing' }
const friendLabels = { SELF: 'You', FRIEND: 'Friend', NONE: 'Not friends yet' }

function displayDate(value) {
  if (!value) return '-'
  return new Intl.DateTimeFormat('zh-TW', { year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(value))
}

export default function RankPlayerDrawer({ open, player, loading, error, onClose }) {
  const closeRef = useRef(null)
  const fallbackAvatar = useMemo(() => getAvatarPresetForPlayer(player), [player])

  useEffect(() => {
    if (!open) return undefined
    const previous = document.activeElement
    const originalOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    closeRef.current?.focus()
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = originalOverflow
      previous?.focus?.()
    }
  }, [open, onClose])

  if (!open) return null

  return createPortal(
    <section
      className="fixed inset-0 z-[1000] overflow-y-auto bg-red-950/72 px-0 py-4 pt-[max(1rem,env(safe-area-inset-top))] backdrop-blur-sm sm:flex sm:items-stretch sm:justify-end sm:py-0"
      role="presentation"
      onMouseDown={onClose}
    >
      <div
        className="luxury-panel mx-auto flex max-h-none min-h-[calc(100dvh-2rem)] w-[min(100%,calc(100vw-1rem))] flex-col overflow-hidden rounded p-0 shadow-2xl sm:mx-0 sm:h-dvh sm:min-h-0 sm:w-[420px] sm:rounded-none"
        role="dialog"
        aria-modal="true"
        aria-labelledby="rank-player-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-yellow-200/15 bg-red-950/95 p-5 backdrop-blur">
          <div>
            <p className="gold-muted text-xs font-black uppercase tracking-[0.25em]">Player</p>
            <h2 id="rank-player-title" className="brand-title mt-1 text-2xl font-black">Player Info</h2>
          </div>
          <button ref={closeRef} type="button" onClick={onClose} className="red-gold-button rounded px-3 py-2 text-xs font-black" aria-label="Close player info">
            Close
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-5">
          {loading && <p className="rounded border border-yellow-200/15 bg-red-950/70 p-4 text-sm font-bold text-yellow-100/70">Loading player data...</p>}
          {error && !loading && <p className="rounded border border-red-400/30 bg-red-500/10 p-4 text-sm font-bold text-red-200">{error}</p>}
          {!loading && !error && player && (
            <div className="grid gap-4 pb-[env(safe-area-inset-bottom)]">
              <div className="flex items-center gap-4 rounded border border-yellow-200/15 bg-red-950/70 p-4">
                <RankPlayerAvatar player={{ ...player, fallbackAvatarUrl: fallbackAvatar.src }} size="xl" />
                <div className="min-w-0">
                  <p className="truncate text-xl font-black text-yellow-100">{player.nickname}</p>
                  <p className="mt-1 text-sm font-bold text-yellow-100/62">Player ID: {player.playerId}</p>
                  <p className="mt-1 text-sm font-bold text-yellow-100/62">Joined: {displayDate(player.joinedAt)}</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <Info label="Selected Rank" value={player.selectedRank ? `#${player.selectedRank}` : '-'} />
                <Info label="Coins Rank" value={player.globalRank ? `#${player.globalRank}` : '-'} />
                <Info label="Daily Rank" value={player.dailyRank ? `#${player.dailyRank}` : '-'} />
                <Info label="Friend Status" value={friendLabels[player.friendStatus] || 'Not friends yet'} />
              </div>

              <div className="rounded border border-yellow-200/15 bg-red-950/70 p-4">
                <p className="gold-muted text-xs font-black uppercase tracking-[0.22em]">Game Ranks</p>
                <div className="mt-3 grid gap-2">
                  {Object.entries(gameLabels).map(([key, label]) => (
                    <div key={key} className="flex items-center justify-between text-sm font-bold text-yellow-100/78">
                      <span>{label}</span>
                      <span className="text-yellow-200">{player.gameRanks?.[key] ? `#${player.gameRanks[key]}` : '-'}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <Info label="Rounds" value={(player.stats?.roundCount ?? 0).toLocaleString()} />
                <Info label="Win Rate" value={player.stats?.winRate == null ? '-' : `${Number(player.stats.winRate).toFixed(1)}%`} />
                <Info label="Favorite" value={gameLabels[player.stats?.favoriteGame] || '-'} />
              </div>

              <button type="button" className="gold-button rounded px-4 py-3 text-sm font-black disabled:opacity-60" disabled={player.friendStatus !== 'NONE'}>
                {player.friendStatus === 'NONE' ? 'Add Friend' : friendLabels[player.friendStatus]}
              </button>
            </div>
          )}
        </div>
      </div>
    </section>,
    document.body,
  )
}

function Info({ label, value }) {
  return (
    <div className="rounded border border-yellow-200/15 bg-red-950/70 p-3">
      <p className="gold-muted text-xs font-bold">{label}</p>
      <p className="mt-1 truncate font-black text-yellow-100">{value}</p>
    </div>
  )
}