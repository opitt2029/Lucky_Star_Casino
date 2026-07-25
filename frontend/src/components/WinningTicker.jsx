import { useEffect, useMemo, useState } from 'react'
import './WinningTicker.css'

const PLAYER_NAMES = [
  'MikaStar',
  'Leo888',
  'NovaKai',
  'NinaQ',
  'AceRay',
  'RubyWin',
  'StarYu',
  'Luna77',
  'HanaGo',
  'KuroAce',
  'SunnyQ',
  'ViviCoin',
]

const WIN_SOURCE_BY_GAME = {
  slot: { game: 'Lucky 777', label: 'SLOT', min: 1800, max: 98800, accent: 'slot' },
  baccarat: { game: 'Baccarat', label: 'BAC', min: 1200, max: 52000, accent: 'baccarat' },
  fishing: { game: 'Dragon Fishing', label: 'FISH', min: 2600, max: 126000, accent: 'fishing' },
}

const MULTIPLIERS_BY_GAME = {
  slot: [2, 3, 5, 8, 18, 40, 70],
  baccarat: [1, 2, 3, 5, 8, 12, 25],
  fishing: [5, 8, 12, 18, 30, 60, 120],
}

function randomFrom(list) {
  return list[Math.floor(Math.random() * list.length)]
}

function randomAmount(min, max) {
  const value = Math.floor(min + Math.random() * (max - min))
  return Math.round(value / 100) * 100
}

function createWinEvent(source, gameKey, index = 0) {
  return {
    id: `${Date.now()}-${gameKey}-${index}-${Math.random().toString(16).slice(2)}`,
    playerName: randomFrom(PLAYER_NAMES),
    game: source.game,
    label: source.label,
    accent: source.accent,
    amount: randomAmount(source.min, source.max),
    multiplier: randomFrom(MULTIPLIERS_BY_GAME[gameKey] || MULTIPLIERS_BY_GAME.slot),
  }
}

function formatAmount(value) {
  return Number(value || 0).toLocaleString('en-US')
}

export default function WinningTicker({ game = 'slot' }) {
  const source = WIN_SOURCE_BY_GAME[game] || WIN_SOURCE_BY_GAME.slot
  const initialEvents = useMemo(
    () => Array.from({ length: 4 }, (_, index) => createWinEvent(source, game, index)),
    [game, source],
  )
  const [events, setEvents] = useState(initialEvents)
  const [collapsed, setCollapsed] = useState(false)

  useEffect(() => {
    setEvents(initialEvents)
  }, [initialEvents])

  useEffect(() => {
    const timer = window.setInterval(() => {
      setEvents((prev) => [createWinEvent(source, game, prev.length), ...prev].slice(0, 4))
    }, 4200)

    return () => window.clearInterval(timer)
  }, [game, source])

  if (collapsed) {
    return (
      <button
        type="button"
        className="winning-ticker winning-ticker--collapsed"
        onClick={() => setCollapsed(false)}
        aria-label={`Open ${source.game} live win board`}
      >
        <span className="winning-ticker__live-dot" aria-hidden="true" />
        <span>{source.label} Wins</span>
      </button>
    )
  }

  const latest = events[0]

  return (
    <aside className={`winning-ticker winning-ticker--${source.accent}`} aria-label={`${source.game} live win board`}>
      <div className="winning-ticker__frame" role="status" aria-live="polite">
        <div className="winning-ticker__header">
          <div>
            <p>{source.label} PAYOUTS</p>
            <h2>Live Wins</h2>
          </div>
          <button type="button" onClick={() => setCollapsed(true)} aria-label={`Collapse ${source.game} live win board`}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 12h12" />
            </svg>
          </button>
        </div>

        <div className={`winning-ticker__hero winning-ticker__hero--${latest.accent}`} key={latest.id}>
          <span className="winning-ticker__spark" aria-hidden="true" />
          <div>
            <strong>{latest.playerName}</strong>
            <span>{latest.game} / {latest.multiplier}x</span>
          </div>
          <b>{formatAmount(latest.amount)}</b>
        </div>

        <div className="winning-ticker__list">
          {events.slice(1).map((event) => (
            <article key={event.id} className="winning-ticker__item">
              <span className={`winning-ticker__badge winning-ticker__badge--${event.accent}`}>{event.label}</span>
              <span className="winning-ticker__name">{event.playerName}</span>
              <strong>{formatAmount(event.amount)}</strong>
            </article>
          ))}
        </div>
      </div>
    </aside>
  )
}