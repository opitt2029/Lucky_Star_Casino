import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import './WinningTicker.css'

const PLAYER_NAMES = [
  '星羽',
  '阿凱777',
  '米卡',
  '妮娜',
  '紅鑽玩家',
  '晴晴',
  '小宇',
  '月光喵',
  '海王星',
  '黑桃高手',
  '金幣獵手',
  '幸運薇薇',
]

const WIN_SOURCE_BY_GAME = {
  slot: {
    game: '幸運 777 老虎機',
    label: '老虎機',
    room: '豪華拉霸房',
    min: 1800,
    max: 98800,
    accent: 'slot',
    winTypes: ['紅 7 連線', '櫻桃連擊', '金鈴組合', '星星加倍'],
    details: ['中線命中', '極速旋轉', '自動旋轉連段', '高額押注桌'],
  },
  baccarat: {
    game: '百家樂',
    label: '百家樂',
    room: '貴賓牌桌',
    min: 1200,
    max: 52000,
    accent: 'baccarat',
    winTypes: ['莊家勝出', '閒家勝出', '和局命中', '對子邊注'],
    details: ['天牌 9 點', '咪牌揭曉', '路單連莊', '返水已入帳'],
  },
  fishing: {
    game: '龍王捕魚機',
    label: '捕魚機',
    room: '深海獵場',
    min: 2600,
    max: 126000,
    accent: 'fishing',
    winTypes: ['首領捕獲', '暴擊命中', '連鎖捕獲', '寶藏魚群'],
    details: ['黃金砲台', '鎖定射擊', '連段捕獲', '獎池浪潮'],
  },
}

const MULTIPLIERS_BY_GAME = {
  slot: [2, 3, 5, 8, 18, 40, 70],
  baccarat: [1, 2, 3, 5, 8, 12, 25],
  fishing: [5, 8, 12, 18, 30, 60, 120],
}

const TIER_LABELS = {
  mega: '超級大獎',
  big: '大獎',
  hot: '熱門中獎',
}

function randomFrom(list) {
  return list[Math.floor(Math.random() * list.length)]
}

function randomAmount(min, max) {
  const value = Math.floor(min + Math.random() * (max - min))
  return Math.round(value / 100) * 100
}

function getTierKey(multiplier) {
  if (multiplier >= 60) return 'mega'
  if (multiplier >= 18) return 'big'
  return 'hot'
}

function createWinEvent(source, gameKey, index = 0) {
  const multiplier = randomFrom(MULTIPLIERS_BY_GAME[gameKey] || MULTIPLIERS_BY_GAME.slot)
  const tierKey = getTierKey(multiplier)
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
    tierKey,
    tierLabel: TIER_LABELS[tierKey],
  }
}

function formatAmount(value) {
  return Number(value || 0).toLocaleString('zh-TW')
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
      aria-label={`展開${source.game}即時中獎公告`}
    >
      <span className="winning-ticker__live-dot" aria-hidden="true" />
      <span>{source.label}快訊</span>
      <strong>{formatAmount(latest.amount)}</strong>
    </button>
  ) : (
    <aside className={`winning-ticker winning-ticker--${source.accent}`} aria-label={`${source.game}即時中獎公告`}>
      <div className="winning-ticker__frame" role="status" aria-live="polite">
        <div className="winning-ticker__header">
          <div>
            <p>
              <span className="winning-ticker__live-dot" aria-hidden="true" />
              {source.label} 即時派彩
            </p>
            <h2>{source.room}</h2>
          </div>
          <button type="button" onClick={() => setCollapsed(true)} aria-label={`收合${source.game}即時中獎公告`}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 12h12" />
            </svg>
          </button>
        </div>

        <div className={`winning-ticker__hero winning-ticker__hero--${latest.accent}`} key={latest.id}>
          <span className="winning-ticker__spark" aria-hidden="true" />
          <div className="winning-ticker__hero-main">
            <span className={`winning-ticker__tier winning-ticker__tier--${latest.tierKey}`}>{latest.tierLabel}</span>
            <strong>{latest.playerName}</strong>
            <span>{latest.winType} / {latest.detail}</span>
          </div>
          <div className="winning-ticker__amount">
            <b>{formatAmount(latest.amount)}</b>
            <span>{latest.multiplier} 倍派彩</span>
          </div>
        </div>

        <div className="winning-ticker__detail-grid" aria-label="最新派彩細節">
          <div>
            <span>遊戲</span>
            <strong>{latest.game}</strong>
          </div>
          <div>
            <span>連段</span>
            <strong>{latest.streak} 局連動</strong>
          </div>
          <div>
            <span>時間</span>
            <strong>{latest.secondsAgo} 秒前</strong>
          </div>
        </div>

        <div className="winning-ticker__list">
          {events.slice(1).map((event) => (
            <article key={event.id} className="winning-ticker__item">
              <span className={`winning-ticker__badge winning-ticker__badge--${event.accent}`}>{event.tierLabel}</span>
              <span className="winning-ticker__name">
                <strong>{event.playerName}</strong>
                <small>{event.winType}</small>
              </span>
              <span className="winning-ticker__item-amount">
                <strong>{formatAmount(event.amount)}</strong>
                <small>{event.multiplier} 倍</small>
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