import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
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
  slot: {
    game: 'Lucky 777',
    label: 'SLOT',
    room: 'Deluxe Room',
    min: 1800,
    max: 98800,
    accent: 'slot',
    winTypes: ['Red 7 Line', 'Cherry Rush', 'Bell Combo', 'Star Bonus'],
    details: ['Middle payline', 'Turbo spin', 'Auto spin streak', 'Max bet table'],
  },
  baccarat: {
    game: 'Baccarat',
    label: 'BAC',
    room: 'VIP Table',
    min: 1200,
    max: 52000,
    accent: 'baccarat',
    winTypes: ['Banker Win', 'Player Win', 'Tie Strike', 'Pair Side Bet'],
    details: ['Natural 9', 'Squeeze reveal', 'Road streak', 'Commission paid'],
  },
  fishing: {
    game: 'Dragon Fishing',
    label: 'FISH',
    room: 'Deep Sea Arena',
    min: 2600,
    max: 126000,
    accent: 'fishing',
    winTypes: ['Boss Catch', 'Critical Hit', 'Rapid Chain', 'Treasure Fish'],
    details: ['Gold cannon', 'Lock-on shot', 'Combo capture', 'Jackpot wave'],
  },
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
  const multiplier = randomFrom(MULTIPLIERS_BY_GAME[gameKey] || MULTIPLIERS_BY_GAME.slot)
  return {
    id: `${Date.now()}-${gameKey}-${index}-${Math.random().toString(16).slice(2)}`,
    playerName: randomFrom(PLAYER_NAMES),
    game: source.game,
    label: source.label,
    room: source.room,
    accent: source.accent,
    amount: randomAmount(source.min, source.max),
    multiplier,
    winType: randomFrom(source.winTypes),
    detail: randomFrom(source.details),
    streak: Math.floor(2 + Math.random() * 8),
    secondsAgo: Math.floor(3 + Math.random() * 42),
    tier: multiplier >= 60 ? 'MEGA' : multiplier >= 18 ? 'BIG' : 'HOT',
  }
}

function formatAmount(value) {
  return Number(value || 0).toLocaleString('en-US')
}

function useTickerHost() {
  const [host, setHost] = useState(null)

  useEffect(() => {
    const resolveHost = () => setHost(document.fullscreenElement || document.body)
    resolveHost()
    document.addEventListener('fullscreenchange', resolveHost)
    return () => document.removeEventListener('fullscreenchange', resolveHost)
  }, [])

  return host
}

export default function WinningTicker({ game = 'slot' }) {
  const source = WIN_SOURCE_BY_GAME[game] || WIN_SOURCE_BY_GAME.slot
  const host = useTickerHost()
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

  const latest = events[0]
  const content = collapsed ? (
    <button
      type="button"
      className={`winning-ticker winning-ticker--collapsed winning-ticker--${source.accent}`}
      onClick={() => setCollapsed(false)}
      aria-label={`Open ${source.game} live win board`}
    >
      <span className="winning-ticker__live-dot" aria-hidden="true" />
      <span>{source.label} Wins</span>
      <strong>{formatAmount(latest.amount)}</strong>
    </button>
  ) : (
    <aside className={`winning-ticker winning-ticker--${source.accent}`} aria-label={`${source.game} live win board`}>
      <div className="winning-ticker__frame" role="status" aria-live="polite">
        <div className="winning-ticker__header">
          <div>
            <p>
              <span className="winning-ticker__live-dot" aria-hidden="true" />
              {source.label} LIVE PAYOUTS
            </p>
            <h2>{source.room}</h2>
          </div>
          <button type="button" onClick={() => setCollapsed(true)} aria-label={`Collapse ${source.game} live win board`}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 12h12" />
            </svg>
          </button>
        </div>

        <div className={`winning-ticker__hero winning-ticker__hero--${latest.accent}`} key={latest.id}>
          <span className="winning-ticker__spark" aria-hidden="true" />
          <div className="winning-ticker__hero-main">
            <span className={`winning-ticker__tier winning-ticker__tier--${latest.tier.toLowerCase()}`}>{latest.tier} HIT</span>
            <strong>{latest.playerName}</strong>
            <span>{latest.winType} / {latest.detail}</span>
          </div>
          <div className="winning-ticker__amount">
            <b>{formatAmount(latest.amount)}</b>
            <span>{latest.multiplier}x paid</span>
          </div>
        </div>

        <div className="winning-ticker__detail-grid" aria-label="Latest payout details">
          <div>
            <span>Game</span>
            <strong>{latest.game}</strong>
          </div>
          <div>
            <span>Streak</span>
            <strong>{latest.streak} rounds</strong>
          </div>
          <div>
            <span>Time</span>
            <strong>{latest.secondsAgo}s ago</strong>
          </div>
        </div>

        <div className="winning-ticker__list">
          {events.slice(1).map((event) => (
            <article key={event.id} className="winning-ticker__item">
              <span className={`winning-ticker__badge winning-ticker__badge--${event.accent}`}>{event.tier}</span>
              <span className="winning-ticker__name">
                <strong>{event.playerName}</strong>
                <small>{event.winType}</small>
              </span>
              <span className="winning-ticker__item-amount">
                <strong>{formatAmount(event.amount)}</strong>
                <small>{event.multiplier}x</small>
              </span>
            </article>
          ))}
        </div>
      </div>
    </aside>
  )

  if (!host) return content
  return createPortal(content, host)
}