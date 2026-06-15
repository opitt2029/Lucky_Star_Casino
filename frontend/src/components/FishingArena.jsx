import { useCallback, useEffect, useRef, useState } from 'react'
import Art from '../casino-fx/assets/Art'
import './Fishing.css'

// 依倍率/魚種推導渲染參數（尺寸、出現權重、游速、層級）。
function deriveMeta(fish) {
  const m = fish.multiplier
  if (fish.code === 'MONEY_TREE') return { tier: 'special', size: 100, weight: 0.8, durMin: 11, durMax: 14 }
  if (m <= 8) return { tier: 'small', size: 56 + m * 3, weight: 6, durMin: 7, durMax: 9.5 }
  if (m <= 25) return { tier: 'medium', size: 94, weight: 2.2, durMin: 9, durMax: 11.5 }
  return { tier: 'boss', size: 132, weight: 0.5, durMin: 12, durMax: 15.5 }
}

function weightedPick(table) {
  const total = table.reduce((sum, f) => sum + f._meta.weight, 0)
  let r = Math.random() * total
  for (const f of table) {
    r -= f._meta.weight
    if (r <= 0) return f
  }
  return table[0]
}

const MAX_FISH = 14
const SPAWN_INTERVAL_MS = 850

/**
 * 捕魚機漁場：魚群游動、點擊射擊、命中演出。
 *
 * 射擊送出交給上層 hook 的 {@code fire}；批次結果由 {@code registerResults} 註冊的
 * handler 接收後驅動命中/逃跑演出。派彩特效與贏錢音效由上層（Fishing 頁）透過
 * {@code onCatch}/{@code onMiss} 觸發（全螢幕 fx-layer 疊層）。
 */
export default function FishingArena({
  phase,
  betPerShot,
  fishTable,
  fire,
  play,
  registerResults,
  onCatch,
  onMiss,
  onBossChange,
}) {
  const arenaRef = useRef(null)
  const idRef = useRef(0)
  const pendingRef = useRef(new Map()) // shotSeq → { fishId, code, multiplier, tier, xPct, yPct }
  const betRef = useRef(betPerShot)
  betRef.current = betPerShot

  const [fishes, setFishes] = useState([])
  const [aim, setAim] = useState(0)
  const [bullets, setBullets] = useState([])
  const [sparks, setSparks] = useState([])
  const [floats, setFloats] = useState([])
  const [hint, setHint] = useState('')

  // 魚表附加渲染中繼資料。
  const tableRef = useRef([])
  tableRef.current = (fishTable || []).map((f) => ({ ...f, _meta: deriveMeta(f) }))

  // 魚群生成
  useEffect(() => {
    if (phase !== 'playing') return undefined
    const spawn = () => {
      setFishes((prev) => {
        if (prev.length >= MAX_FISH || tableRef.current.length === 0) return prev
        const pick = weightedPick(tableRef.current)
        const meta = pick._meta
        const dir = Math.random() > 0.5 ? 'ltr' : 'rtl'
        const id = (idRef.current += 1)
        if (meta.tier === 'boss') play?.('bossAlarm')
        return [
          ...prev,
          {
            id,
            code: pick.code,
            name: pick.name,
            assetId: pick.assetId,
            multiplier: pick.multiplier,
            tier: meta.tier,
            size: meta.size,
            dir,
            top: 6 + Math.random() * 60, // %
            dur: meta.durMin + Math.random() * (meta.durMax - meta.durMin),
            caught: false,
          },
        ]
      })
    }
    spawn()
    const timer = window.setInterval(spawn, SPAWN_INTERVAL_MS)
    return () => window.clearInterval(timer)
  }, [phase, play])

  // Boss 在場通知（切 boss BGM）
  useEffect(() => {
    const bossActive = fishes.some((f) => !f.caught && f.tier === 'boss')
    onBossChange?.(bossActive)
  }, [fishes, onBossChange])

  const removeFish = useCallback((id) => {
    setFishes((prev) => prev.filter((f) => f.id !== id))
  }, [])

  const showHint = useCallback((text) => {
    setHint(text)
    window.setTimeout(() => setHint((cur) => (cur === text ? '' : cur)), 1400)
  }, [])

  // 命中結果處理（由上層 hook 的 onResults 轉接進來）
  const handleResults = useCallback(
    (results) => {
      const bet = betRef.current || 1
      for (const r of results) {
        const pending = pendingRef.current.get(r.shotSeq)
        pendingRef.current.delete(r.shotSeq)
        if (!pending) continue
        if (!r.accepted) {
          showHint('局內餘額不足，請結算後再加值')
          continue
        }
        if (r.hit && r.payout > 0) {
          const effMult = Math.max(1, Math.round(r.payout / bet))
          play?.('hit')
          play?.('net')
          play?.('fishCaught')
          spawnSpark(pending.xPct, pending.yPct)
          spawnFloat(pending.xPct, pending.yPct, r.payout)
          // 標記該魚捕獲（淡出動畫後移除）
          setFishes((prev) => prev.map((f) => (f.id === pending.fishId ? { ...f, caught: true } : f)))
          window.setTimeout(() => removeFish(pending.fishId), 520)
          onCatch?.({ payout: r.payout, multiplier: pending.multiplier, effMult, tier: pending.tier })
        } else {
          // 高倍魚逃跑：near-miss 惋惜音
          if (pending.multiplier >= 15) play?.('fishEscape')
          onMiss?.({ multiplier: pending.multiplier })
        }
      }
    },
    [onCatch, onMiss, play, removeFish, showHint],
  )

  useEffect(() => {
    registerResults?.(handleResults)
  }, [registerResults, handleResults])

  function spawnSpark(xPct, yPct) {
    const id = (idRef.current += 1)
    setSparks((prev) => [...prev, { id, xPct, yPct }])
    window.setTimeout(() => setSparks((prev) => prev.filter((s) => s.id !== id)), 460)
  }

  function spawnFloat(xPct, yPct, payout) {
    const id = (idRef.current += 1)
    setFloats((prev) => [...prev, { id, xPct, yPct, payout }])
    window.setTimeout(() => setFloats((prev) => prev.filter((s) => s.id !== id)), 1000)
  }

  function spawnBullet(targetX, targetY) {
    const rect = arenaRef.current?.getBoundingClientRect()
    if (!rect) return
    const startX = rect.width / 2
    const startY = rect.height - 54
    const id = (idRef.current += 1)
    const bullet = {
      id,
      x: startX,
      y: startY,
      dx: targetX - startX,
      dy: targetY - startY,
    }
    setBullets((prev) => [...prev, bullet])
    window.setTimeout(() => setBullets((prev) => prev.filter((b) => b.id !== id)), 340)
  }

  const handleFishClick = (event, fish) => {
    event.stopPropagation()
    if (phase !== 'playing' || fish.caught) return
    const rect = arenaRef.current.getBoundingClientRect()
    const px = event.clientX - rect.left
    const py = event.clientY - rect.top
    const xPct = (px / rect.width) * 100
    const yPct = (py / rect.height) * 100

    // 砲台瞄準
    const cx = rect.width / 2
    const cy = rect.height
    setAim((Math.atan2(px - cx, cy - py) * 180) / Math.PI)

    if (fish.tier === 'boss' || fish.tier === 'special') play?.('lockOn')

    const res = fire(fish.code)
    if (!res.ok) {
      if (res.reason === 'insufficient') showHint('局內餘額不足，請結算後再加值')
      return
    }
    play?.('shoot', { pitch: 1 + Math.random() * 0.1 })
    spawnBullet(px, py)
    pendingRef.current.set(res.shotSeq, {
      fishId: fish.id,
      code: fish.code,
      multiplier: fish.multiplier,
      tier: fish.tier,
      xPct,
      yPct,
    })
  }

  // 點擊空海域也讓砲台轉向（純表現）
  const handleArenaClick = (event) => {
    if (phase !== 'playing') return
    const rect = arenaRef.current.getBoundingClientRect()
    const px = event.clientX - rect.left
    const py = event.clientY - rect.top
    const cx = rect.width / 2
    const cy = rect.height
    setAim((Math.atan2(px - cx, cy - py) * 180) / Math.PI)
  }

  return (
    <div ref={arenaRef} className="fishing-arena" onClick={handleArenaClick}>
      {fishes.map((fish) => (
        <div
          key={fish.id}
          className={`fishing-fish__swim${fish.dir === 'ltr' ? ' fishing-fish__swim--ltr' : ''}`}
          style={{ top: `${fish.top}%`, width: `${fish.size}px`, animationDuration: `${fish.dur}s` }}
          onAnimationEnd={(e) => {
            if (e.animationName === 'fishSwimRTL' || e.animationName === 'fishSwimLTR') removeFish(fish.id)
          }}
        >
          <button
            type="button"
            className={`fishing-fish${fish.tier === 'boss' ? ' fishing-fish--boss' : ''}${fish.caught ? ' fishing-fish--caught' : ''}`}
            style={{ width: `${fish.size}px`, height: `${fish.size}px` }}
            onClick={(e) => handleFishClick(e, fish)}
            aria-label={`${fish.name} ${fish.multiplier}x`}
          >
            <Art
              id={fish.assetId}
              className={`fishing-fish__sprite${fish.dir === 'ltr' ? ' fishing-fish__sprite--flip' : ''}`}
            />
            <span className="fishing-fish__tag">{fish.name} ×{fish.multiplier}</span>
          </button>
        </div>
      ))}

      {sparks.map((s) => (
        <span key={s.id} className="fishing-spark" style={{ left: `${s.xPct}%`, top: `${s.yPct}%` }} />
      ))}

      {floats.map((f) => (
        <span key={f.id} className="fishing-payout-float" style={{ left: `${f.xPct}%`, top: `${f.yPct}%` }}>
          +{f.payout.toLocaleString()}
        </span>
      ))}

      {bullets.map((b) => (
        <span
          key={b.id}
          className="fishing-bullet"
          style={{ left: `${b.x}px`, top: `${b.y}px`, '--bullet-dx': `${b.dx}px`, '--bullet-dy': `${b.dy}px` }}
        />
      ))}

      <div className="fishing-cannon" style={{ '--aim': `${aim}deg` }}>
        <span className="fishing-cannon__base" />
        <Art id="cannon" className="fishing-cannon__art" />
      </div>

      {hint && <div className="fishing-hint">{hint}</div>}
    </div>
  )
}
