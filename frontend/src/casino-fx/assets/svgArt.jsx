import { useId } from 'react'

// 程式化向量美術素材庫（華人彩頭意象）。所有圖案 viewBox 統一 0 0 100 100、可任意縮放。
// 漸層 id 一律用 useId 避免多實例衝突。之後 AI 精緻圖生成好，由 registry 的 override 換圖，
// 這裡的元件繼續當 fallback。

const GOLD = '#f8d56a'
const GOLD_BRIGHT = '#ffeaa0'
const GOLD_DEEP = '#a56408'
const RED = '#c90d18'
const RED_DEEP = '#7a060e'

function GoldGradient({ id, vertical = false }) {
  return (
    <linearGradient id={id} x1="0" y1="0" x2={vertical ? '0' : '1'} y2={vertical ? '1' : '0.6'}>
      <stop offset="0" stopColor={GOLD_BRIGHT} />
      <stop offset="0.5" stopColor={GOLD} />
      <stop offset="1" stopColor={GOLD_DEEP} />
    </linearGradient>
  )
}

// ---- 老虎機符號 / 通用財富意象 ----

export function GoldIngot(props) {
  const gid = useId()
  return (
    <svg viewBox="0 0 100 100" {...props}>
      <defs><GoldGradient id={gid} /></defs>
      <path d="M18 62c0-7 6-20 14-24 4 8 12 13 18 13s14-5 18-13c8 4 14 17 14 24 0 12-14 20-32 20S18 74 18 62Z" fill={`url(#${gid})`} stroke={GOLD_DEEP} strokeWidth="2.5" />
      <ellipse cx="50" cy="44" rx="17" ry="9" fill={GOLD_BRIGHT} stroke={GOLD_DEEP} strokeWidth="2.5" />
      <ellipse cx="44" cy="42" rx="5" ry="2.4" fill="#fffbe0" opacity="0.9" />
    </svg>
  )
}

export function CopperCoin(props) {
  const gid = useId()
  return (
    <svg viewBox="0 0 100 100" {...props}>
      <defs><GoldGradient id={gid} /></defs>
      <circle cx="50" cy="50" r="38" fill={`url(#${gid})`} stroke={GOLD_DEEP} strokeWidth="3" />
      <circle cx="50" cy="50" r="30" fill="none" stroke={GOLD_DEEP} strokeWidth="1.6" opacity="0.6" />
      <rect x="38" y="38" width="24" height="24" rx="2" fill={RED_DEEP} opacity="0.85" />
      <rect x="42" y="42" width="16" height="16" rx="1" fill={`url(#${gid})`} />
    </svg>
  )
}

export function RedEnvelope(props) {
  const gid = useId()
  return (
    <svg viewBox="0 0 100 100" {...props}>
      <defs>
        <GoldGradient id={gid} />
        <linearGradient id={`${gid}-r`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#e6404b" />
          <stop offset="1" stopColor={RED_DEEP} />
        </linearGradient>
      </defs>
      <rect x="26" y="14" width="48" height="72" rx="6" fill={`url(#${gid}-r)`} stroke={GOLD_DEEP} strokeWidth="2" />
      <path d="M26 22c8 10 16 14 24 14s16-4 24-14" fill="none" stroke={GOLD} strokeWidth="2.5" />
      <circle cx="50" cy="50" r="11" fill={`url(#${gid})`} stroke={GOLD_DEEP} strokeWidth="1.5" />
      <text x="50" y="55" textAnchor="middle" fontSize="13" fontWeight="900" fill={RED_DEEP}>福</text>
    </svg>
  )
}

export function FuChar(props) {
  const gid = useId()
  return (
    <svg viewBox="0 0 100 100" {...props}>
      <defs><GoldGradient id={gid} /></defs>
      <rect x="14" y="14" width="72" height="72" rx="10" transform="rotate(45 50 50)" fill={RED} stroke={`url(#${gid})`} strokeWidth="3.5" />
      <text x="50" y="62" textAnchor="middle" fontSize="36" fontWeight="900" fill={`url(#${gid})`} style={{ fontFamily: "'DFKai-SB','KaiTi','BiauKai',serif" }}>福</text>
    </svg>
  )
}

export function GoldenDragon(props) {
  const gid = useId()
  return (
    <svg viewBox="0 0 100 100" {...props}>
      <defs><GoldGradient id={gid} /></defs>
      {/* 蜿蜒龍身 */}
      <path d="M20 70c0-16 12-22 26-22 12 0 18-5 18-12 0-6-5-10-12-10 4-4 12-5 18-1 7 5 8 16 1 23-8 8-20 8-28 9-8 0-12 5-12 11 0 7 6 11 14 11 10 0 16-4 20-10 2 8-4 19-18 20-15 1-27-7-27-19Z" fill={`url(#${gid})`} stroke={GOLD_DEEP} strokeWidth="2" />
      {/* 龍角與眼 */}
      <path d="M62 18l8-8M70 24l10-4" stroke={GOLD_DEEP} strokeWidth="3" strokeLinecap="round" />
      <circle cx="63" cy="25" r="2.6" fill={RED_DEEP} />
      {/* 龍珠 */}
      <circle cx="30" cy="38" r="7" fill={RED} stroke={GOLD} strokeWidth="2" />
    </svg>
  )
}

export function StarCoin(props) {
  const gid = useId()
  return (
    <svg viewBox="0 0 100 100" {...props}>
      <defs><GoldGradient id={gid} /></defs>
      <circle cx="50" cy="50" r="36" fill={`url(#${gid})`} stroke={GOLD_DEEP} strokeWidth="3" />
      <path d="M50 28l6.5 14 15.5 2-11 11 2.6 15.4L50 63l-13.6 7.4L39 55 28 44l15.5-2L50 28Z" fill={RED} stroke={RED_DEEP} strokeWidth="1.4" />
    </svg>
  )
}

// ---- 捕魚機魚種 ----

function FishBase({ body, tail, fin, eye = '#1b0b06', children, ...props }) {
  return (
    <svg viewBox="0 0 100 100" {...props}>
      <path d={`M88 50c0 0-16 22-44 22C26 72 12 60 12 50s14-22 32-22c28 0 44 22 44 22Z`} fill={body} stroke="rgba(0,0,0,0.25)" strokeWidth="1.6" />
      <path d="M88 50 100 34v32L88 50Z" fill={tail} />
      <path d="M44 28c2-7 10-10 16-8-3 4-4 8-4 10" fill={fin} />
      <path d="M44 72c2 7 10 10 16 8-3-4-4-8-4-10" fill={fin} />
      <circle cx="28" cy="46" r="4" fill="#fff" />
      <circle cx="27" cy="46" r="2.2" fill={eye} />
      {children}
    </svg>
  )
}

export function KoiFish(props) {
  return (
    <FishBase body="#f4f1ea" tail="#e6404b" fin="#e6404b" {...props}>
      <circle cx="48" cy="44" r="7" fill="#e6404b" opacity="0.92" />
      <circle cx="64" cy="54" r="5.4" fill="#1b0b06" opacity="0.85" />
    </FishBase>
  )
}

export function Goldfish(props) {
  return (
    <FishBase body="#ffb347" tail="#ff8c1a" fin="#ffd27a" {...props}>
      <path d="M40 50c8-4 18-4 26 0" stroke="#e07000" strokeWidth="1.6" fill="none" />
    </FishBase>
  )
}

export function LanternFish(props) {
  const gid = useId()
  return (
    <FishBase body="#7a4cc9" tail="#5b32a8" fin="#9a72e0" {...props}>
      <defs>
        <radialGradient id={gid}>
          <stop offset="0" stopColor={GOLD_BRIGHT} />
          <stop offset="1" stopColor={GOLD} stopOpacity="0" />
        </radialGradient>
      </defs>
      <path d="M30 30c-6-8-2-14 2-16" stroke="#9a72e0" strokeWidth="2.4" fill="none" />
      <circle cx="32" cy="12" r="9" fill={`url(#${gid})`} />
      <circle cx="32" cy="12" r="3.6" fill={GOLD_BRIGHT} />
    </FishBase>
  )
}

export function PufferFish(props) {
  return (
    <svg viewBox="0 0 100 100" {...props}>
      <circle cx="50" cy="52" r="30" fill="#8fd0c0" stroke="#3f8a78" strokeWidth="2" />
      {Array.from({ length: 10 }, (_, i) => {
        const angle = (i / 10) * Math.PI * 2
        const x1 = 50 + Math.cos(angle) * 30
        const y1 = 52 + Math.sin(angle) * 30
        const x2 = 50 + Math.cos(angle) * 39
        const y2 = 52 + Math.sin(angle) * 39
        return <path key={i} d={`M${x1} ${y1}L${x2} ${y2}`} stroke="#3f8a78" strokeWidth="2.6" strokeLinecap="round" />
      })}
      <circle cx="38" cy="46" r="4.4" fill="#fff" />
      <circle cx="37" cy="46" r="2.2" fill="#10231e" />
      <path d="M40 62c6 4 14 4 20 0" stroke="#2c6456" strokeWidth="2" fill="none" />
      <path d="M80 52l12-8v16l-12-8Z" fill="#3f8a78" />
    </svg>
  )
}

export function Angelfish(props) {
  return (
    <svg viewBox="0 0 100 100" {...props}>
      <path d="M50 8c10 14 12 26 12 42s-2 28-12 42C40 78 38 66 38 50S40 22 50 8Z" fill="#ffd27a" stroke="#e09a20" strokeWidth="1.6" />
      <path d="M72 50c0 12-10 22-24 22S26 62 26 50s8-22 22-22 24 10 24 22Z" fill="#ffeaa0" stroke="#e09a20" strokeWidth="2" />
      <path d="M26 50 12 38v24l14-12Z" fill="#e09a20" />
      <circle cx="60" cy="44" r="4" fill="#fff" />
      <circle cx="61" cy="44" r="2" fill="#1b0b06" />
      <path d="M40 32c-2 12-2 24 0 36" stroke="#e09a20" strokeWidth="1.8" fill="none" />
    </svg>
  )
}

export function DevilRay(props) {
  return (
    <svg viewBox="0 0 100 100" {...props}>
      <path d="M50 24C24 24 6 44 4 58c14-4 22-2 30 4 4-12 10-14 16-14s12 2 16 14c8-6 16-8 30-4-2-14-20-34-46-34Z" fill="#3b4a8c" stroke="#222d5c" strokeWidth="2" />
      <path d="M46 70c0 8 2 14 4 18 2-4 4-10 4-18" fill="#3b4a8c" />
      <path d="M38 26c-2-6-8-10-12-10 2 4 4 8 4 12M62 26c2-6 8-10 12-10-2 4-4 8-4 12" fill="#222d5c" />
      <circle cx="40" cy="40" r="3.4" fill="#fff" />
      <circle cx="40" cy="40" r="1.8" fill="#0c1230" />
      <circle cx="60" cy="40" r="3.4" fill="#fff" />
      <circle cx="60" cy="40" r="1.8" fill="#0c1230" />
    </svg>
  )
}

export function GoldDragonFish(props) {
  const gid = useId()
  return (
    <svg viewBox="0 0 100 100" {...props}>
      <defs><GoldGradient id={gid} /></defs>
      <path d="M90 50c0 0-18 20-46 20C26 70 10 60 10 50s16-20 34-20c28 0 46 20 46 20Z" fill={`url(#${gid})`} stroke={GOLD_DEEP} strokeWidth="2.4" />
      {Array.from({ length: 5 }, (_, i) => (
        <path key={i} d={`M${34 + i * 11} 34c4 8 4 24 0 32`} stroke={GOLD_DEEP} strokeWidth="1.4" fill="none" opacity="0.55" />
      ))}
      <path d="M90 50l10-14v28L90 50Z" fill={GOLD} stroke={GOLD_DEEP} strokeWidth="1.4" />
      <path d="M22 38l-8-8M22 62l-8 8" stroke={GOLD_DEEP} strokeWidth="3" strokeLinecap="round" />
      <circle cx="24" cy="46" r="4" fill="#fff" />
      <circle cx="23" cy="46" r="2.2" fill={RED_DEEP} />
      <path d="M14 52c4 3 8 3 12 1" stroke={GOLD_DEEP} strokeWidth="1.6" fill="none" />
    </svg>
  )
}

export function Pixiu(props) {
  const gid = useId()
  return (
    <svg viewBox="0 0 100 100" {...props}>
      <defs><GoldGradient id={gid} vertical /></defs>
      {/* 獸首 */}
      <path d="M50 14c22 0 34 14 34 32 0 20-14 34-34 34S16 66 16 46c0-18 12-32 34-32Z" fill={`url(#${gid})`} stroke={GOLD_DEEP} strokeWidth="2.6" />
      {/* 雙角 */}
      <path d="M30 18c-4-8-12-10-16-8 4 2 6 8 8 14M70 18c4-8 12-10 16-8-4 2-6 8-8 14" fill={GOLD_DEEP} />
      {/* 怒眉與眼 */}
      <path d="M28 40l14-5M72 40l-14-5" stroke={RED_DEEP} strokeWidth="3.4" strokeLinecap="round" />
      <circle cx="36" cy="47" r="4.6" fill={RED} />
      <circle cx="64" cy="47" r="4.6" fill={RED} />
      {/* 吞財大口含銅錢 */}
      <path d="M32 62c6 8 30 8 36 0l-4 12c-6 5-22 5-28 0l-4-12Z" fill={RED_DEEP} />
      <circle cx="50" cy="66" r="7" fill={GOLD_BRIGHT} stroke={GOLD_DEEP} strokeWidth="1.6" />
      <rect x="47" y="63" width="6" height="6" fill={RED_DEEP} />
    </svg>
  )
}

export function Caishen(props) {
  const gid = useId()
  return (
    <svg viewBox="0 0 100 100" {...props}>
      <defs><GoldGradient id={gid} /></defs>
      {/* 官帽 */}
      <rect x="28" y="10" width="44" height="14" rx="4" fill={RED_DEEP} stroke={`url(#${gid})`} strokeWidth="2" />
      <rect x="8" y="14" width="18" height="6" rx="3" fill={RED_DEEP} />
      <rect x="74" y="14" width="18" height="6" rx="3" fill={RED_DEEP} />
      <circle cx="50" cy="10" r="4" fill={`url(#${gid})`} />
      {/* 臉 */}
      <circle cx="50" cy="42" r="18" fill="#f7c8a0" stroke="#c98b54" strokeWidth="1.6" />
      <path d="M42 38c2-2 5-2 7 0M58 38c-2-2-5-2-7 0" stroke="#5a2d10" strokeWidth="2" fill="none" />
      <path d="M44 50c4 3 8 3 12 0" stroke="#5a2d10" strokeWidth="2" fill="none" strokeLinecap="round" />
      <path d="M36 52c-2 8-2 12 2 16M64 52c2 8 2 12-2 16" stroke="#2c2c2c" strokeWidth="2.4" fill="none" />
      {/* 紅袍與金元寶 */}
      <path d="M26 92c0-18 10-30 24-30s24 12 24 30H26Z" fill={RED} stroke={RED_DEEP} strokeWidth="2" />
      <path d="M40 78c1-4 4-8 6-9 2 3 5 4 8 4 2 0 4-1 6-4 2 1 5 5 6 9 0 5-6 8-13 8s-13-3-13-8Z" fill={`url(#${gid})`} stroke={GOLD_DEEP} strokeWidth="1.6" />
    </svg>
  )
}

export function DragonKing(props) {
  const gid = useId()
  return (
    <svg viewBox="0 0 100 100" {...props}>
      <defs>
        <GoldGradient id={gid} />
        <linearGradient id={`${gid}-b`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2e8c6a" />
          <stop offset="1" stopColor="#10402e" />
        </linearGradient>
      </defs>
      {/* 龍首 */}
      <path d="M50 18c20 0 32 12 34 28 2 14-6 28-16 34l-6-10c-4 4-8 6-12 6s-8-2-12-6l-6 10C22 74 14 60 16 46c2-16 14-28 34-28Z" fill={`url(#${gid}-b)`} stroke="#0a2a1e" strokeWidth="2.4" />
      {/* 鹿角 */}
      <path d="M30 22c-6-10-2-16 2-20 0 6 4 10 8 12M70 22c6-10 2-16-2-20 0 6-4 10-8 12" fill="none" stroke={`url(#${gid})`} strokeWidth="4" strokeLinecap="round" />
      {/* 火焰眉與龍眼 */}
      <path d="M26 40c6-4 12-4 16-2M74 40c-6-4-12-4-16-2" stroke={GOLD} strokeWidth="3" strokeLinecap="round" />
      <circle cx="37" cy="48" r="5" fill={GOLD_BRIGHT} />
      <circle cx="37" cy="48" r="2.6" fill={RED} />
      <circle cx="63" cy="48" r="5" fill={GOLD_BRIGHT} />
      <circle cx="63" cy="48" r="2.6" fill={RED} />
      {/* 鬚 */}
      <path d="M40 64c-8 2-12 8-12 14M60 64c8 2 12 8 12 14" stroke={GOLD} strokeWidth="2.2" fill="none" strokeLinecap="round" />
      {/* 含龍珠 */}
      <circle cx="50" cy="68" r="8" fill={RED} stroke={GOLD} strokeWidth="2.4" />
      <circle cx="47" cy="65" r="2.4" fill={GOLD_BRIGHT} opacity="0.9" />
    </svg>
  )
}

export function MoneyTree(props) {
  const gid = useId()
  return (
    <svg viewBox="0 0 100 100" {...props}>
      <defs><GoldGradient id={gid} /></defs>
      <path d="M46 92c2-14 2-26-2-38l8 2c-2 12-2 24 0 36h-6Z" fill="#7a4a1e" stroke="#532f10" strokeWidth="1.6" />
      <circle cx="50" cy="38" r="26" fill="#2e8c6a" stroke="#10402e" strokeWidth="2" />
      <circle cx="34" cy="30" r="9" fill="#3aa87e" />
      <circle cx="62" cy="24" r="10" fill="#3aa87e" />
      {[[34, 40], [52, 32], [64, 46], [44, 22]].map(([x, y], i) => (
        <g key={i}>
          <circle cx={x} cy={y} r="6" fill={`url(#${gid})`} stroke={GOLD_DEEP} strokeWidth="1.4" />
          <rect x={x - 2.4} y={y - 2.4} width="4.8" height="4.8" fill="#10402e" />
        </g>
      ))}
      <ellipse cx="50" cy="92" rx="20" ry="5" fill={`url(#${gid})`} opacity="0.7" />
    </svg>
  )
}

export function Cannon(props) {
  const gid = useId()
  return (
    <svg viewBox="0 0 100 100" {...props}>
      <defs><GoldGradient id={gid} vertical /></defs>
      {/* 底座 */}
      <path d="M22 92c0-12 12-20 28-20s28 8 28 20H22Z" fill={RED_DEEP} stroke={GOLD_DEEP} strokeWidth="2" />
      <circle cx="50" cy="74" r="12" fill={`url(#${gid})`} stroke={GOLD_DEEP} strokeWidth="2" />
      {/* 炮管 */}
      <path d="M42 70 36 22c0-6 6-10 14-10s14 4 14 10l-6 48" fill={`url(#${gid})`} stroke={GOLD_DEEP} strokeWidth="2.4" />
      <rect x="34" y="14" width="32" height="10" rx="5" fill={RED} stroke={GOLD_DEEP} strokeWidth="2" />
      <path d="M44 34h12M45 44h10" stroke={GOLD_DEEP} strokeWidth="2" strokeLinecap="round" opacity="0.7" />
    </svg>
  )
}

// 簡單金幣（粒子特效用，輕量）。
export function SimpleCoin(props) {
  return (
    <svg viewBox="0 0 100 100" {...props}>
      <circle cx="50" cy="50" r="44" fill={GOLD} stroke={GOLD_DEEP} strokeWidth="5" />
      <circle cx="50" cy="50" r="30" fill="none" stroke={GOLD_DEEP} strokeWidth="3" opacity="0.5" />
      <ellipse cx="38" cy="36" rx="10" ry="6" fill="#fffbe0" opacity="0.85" />
    </svg>
  )
}
