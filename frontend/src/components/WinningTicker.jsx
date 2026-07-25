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

const WIN_SOURCES = [
  { game: 'Lucky 777', label: 'SLOT', min: 1800, max: 98800, accent: 'slot' },
  { game: 'Baccarat', label: 'BAC', min: 1200, max: 52000, accent: 'baccarat' },
  { game: 'Dragon Fishing', label: 'FISH', min: 2600, max: 126000, accent: 'fishing' },
]

function randomFrom(list) {
  return list[Math.floor(Math.random() * list.length)]
}

function randomAmount(min, max) {
  const value = Math.floor(min + Math.random() * (max - min))
  return Math.round(value / 100) * 100
}

function createWinEvent(index = 0) {
  const source = randomFrom(WIN_SOURCES)
  return {
    id: `${Date.now()}-${index}-${Math.random().toString(16).slice(2)}`,
    playerName: randomFrom(PLAYER_NAMES),
    game: source.game,
    label: source.label,
    accent: source.accent,
    amount: randomAmount(source.min, source.max),
    multiplier: [3, 5, 7, 12, 18, 25, 40, 70][Math.floor(Math.random() * 8)],
  }
}

function formatAmount(value) {
  return Number(value || 0).toLocaleString('en-US')
}

export default function WinningTicker() {
  const initialEvents = useMemo(() => Array.from({ length: 4 }, (_, index) => createWinEvent(index)), [])
  const [events, setEvents] = useState(initialEvents)
  const [collapsed, setCollapsed] = useState(false)

  useEffect(() => {
    const timer = window.setInterval(() => {
      setEvents((prev) => [createWinEvent(prev.length), ...prev].slice(0, 4))
    }, 4200)

    return () => window.clearInterval(timer)
  }, [])

  if (collapsed) {
    return (
      <button
        type="button"
        className="winning-ticker winning-ticker--collapsed"
        onClick={() => setCollapsed(false)}
        aria-label="Open live win board"
      >
        <span className="winning-ticker__live-dot" aria-hidden="true" />
        <span>Live Wins</span>
      </button>
    )
  }

  const latest = events[0]

  return (
    <aside className="winning-ticker" aria-label="Live win board">
      <div className="winning-ticker__frame" role="status" aria-live="polite">
        <div className="winning-ticker__header">
          <div>
            <p>LIVE PAYOUTS</p>
            <h2>Live Wins</h2>
          </div>
          <button type="button" onClick={() => setCollapsed(true)} aria-label="Collapse live win board">
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