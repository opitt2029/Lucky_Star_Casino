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
// 按住連發：朝游標方向持續開火的取樣節奏（實際射速由 hook 的 token bucket 限到 8 發/秒）。
const FIRE_INTERVAL_MS = 110
// 游標命中判定半徑（px）：游標距魚中心在此範圍內視為瞄到該魚，給連發掃射足夠容錯。
const AIM_RADIUS = 92

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

  // 按住連發相關即時狀態（用 ref 避免閉包過期）。
  const pointerRef = useRef(null) // 游標在 arena 內座標 { x, y }
  const holdingRef = useRef(false)
  const fireTimerRef = useRef(null)
  const fishesRef = useRef([])
  fishesRef.current = fishes

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
        if (r.captured && r.payout > 0) {
          // 致命一擊 + 捕獲：派彩演出（淡出後移除）
          const effMult = Math.max(1, Math.round(r.payout / bet))
          play?.('hit')
          play?.('net')
          play?.('fishCaught')
          spawnSpark(pending.xPct, pending.yPct)
          spawnFloat(pending.xPct, pending.yPct, r.payout)
          setFishes((prev) => prev.map((f) => (f.id === pending.fishId ? { ...f, caught: true } : f)))
          window.setTimeout(() => removeFish(pending.fishId), 520)
          onCatch?.({ payout: r.payout, multiplier: pending.multiplier, effMult, tier: pending.tier })
        } else if (r.killed) {
          // 致命一擊但掙脫逃跑：移除魚 + 高倍惋惜音
          if (pending.multiplier >= 15) play?.('fishEscape')
          removeFish(pending.fishId)
          onMiss?.({ multiplier: pending.multiplier })
        } else {
          // 命中但未死（擦傷）：火花回饋，不移除魚；高頻音交由 soundEngine 節流
          play?.('hit')
          spawnSpark(pending.xPct, pending.yPct)
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

  // 指標事件 → arena 內座標
  const toLocal = (event) => {
    const rect = arenaRef.current.getBoundingClientRect()
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }

  // 砲台朝 (px,py) 的轉角（度）
  const aimFor = (px, py) => {
    const rect = arenaRef.current.getBoundingClientRect()
    return (Math.atan2(px - rect.width / 2, rect.height - py) * 180) / Math.PI
  }

  // 找出距游標最近、且在容錯半徑內的活魚（連發掃射的瞄準對象）。
  function nearestFish(px, py) {
    const root = arenaRef.current
    if (!root) return null
    const rect = root.getBoundingClientRect()
    let best = null
    let bestDist = AIM_RADIUS
    for (const fish of fishesRef.current) {
      if (fish.caught) continue
      const el = root.querySelector(`[data-fish-id="${fish.id}"]`)
      if (!el) continue
      const r = el.getBoundingClientRect()
      const fx = r.left - rect.left + r.width / 2
      const fy = r.top - rect.top + r.height / 2
      const dist = Math.hypot(fx - px, fy - py)
      if (dist <= bestDist) {
        bestDist = dist
        best = fish
      }
    }
    return best
  }

  // 對指定魚開一發（鍵盤無障礙 + 連發掃射共用）。
  // 回傳 'fired' | 'ratelimited' | 'insufficient' | 'inactive'。
  const engageFish = useCallback(
    (fish) => {
      const root = arenaRef.current
      if (!root || phase !== 'playing' || fish.caught) return 'inactive'
      const el = root.querySelector(`[data-fish-id="${fish.id}"]`)
      if (!el) return 'inactive'
      const rect = root.getBoundingClientRect()
      const r = el.getBoundingClientRect()
      const px = r.left - rect.left + r.width / 2
      const py = r.top - rect.top + r.height / 2
      setAim(aimFor(px, py))
      if (fish.tier === 'boss' || fish.tier === 'special') play?.('lockOn')

      const res = fire(String(fish.id), fish.code)
      if (!res.ok) {
        if (res.reason === 'insufficient') showHint('局內餘額不足，請結算後再加值')
        return res.reason
      }
      play?.('shoot', { pitch: 1 + Math.random() * 0.1 })
      spawnBullet(px, py)
      pendingRef.current.set(res.shotSeq, {
        fishId: fish.id,
        code: fish.code,
        multiplier: fish.multiplier,
        tier: fish.tier,
        xPct: (px / rect.width) * 100,
        yPct: (py / rect.height) * 100,
      })
      return 'fired'
    },
    [phase, fire, play, showHint],
  )

  // 朝游標方向開火：瞄到魚就實際開火（扣注、進批次）；空海域只放純視覺曳光，不扣注。
  const fireToward = useCallback(
    (px, py) => {
      if (phase !== 'playing') return
      setAim(aimFor(px, py))
      const fish = nearestFish(px, py)
      // 沒瞄到魚、或被 token bucket 限流的空檔 → 補一發純視覺曳光，讓連發節奏不頓挫。
      if (!fish || engageFish(fish) === 'ratelimited') {
        play?.('shoot', { pitch: 1 + Math.random() * 0.1 })
        spawnBullet(px, py)
      }
    },
    [phase, engageFish, play],
  )

  const fireTowardRef = useRef(fireToward)
  fireTowardRef.current = fireToward

  const stopFireLoop = () => {
    if (fireTimerRef.current) {
      window.clearInterval(fireTimerRef.current)
      fireTimerRef.current = null
    }
  }

  const startFireLoop = () => {
    stopFireLoop()
    fireTimerRef.current = window.setInterval(() => {
      const p = pointerRef.current
      if (p) fireTowardRef.current(p.x, p.y)
    }, FIRE_INTERVAL_MS)
  }

  const handlePointerDown = (event) => {
    if (phase !== 'playing' || event.button === 2) return // 略過右鍵
    event.preventDefault()
    const p = toLocal(event)
    pointerRef.current = p
    holdingRef.current = true
    try {
      arenaRef.current?.setPointerCapture?.(event.pointerId)
    } catch {
      /* 不支援 pointer capture 時退化為一般事件 */
    }
    fireToward(p.x, p.y) // 立即開第一發
    startFireLoop()
  }

  const handlePointerMove = (event) => {
    if (phase !== 'playing') return
    const p = toLocal(event)
    pointerRef.current = p
    setAim(aimFor(p.x, p.y))
  }

  const handlePointerUp = (event) => {
    if (!holdingRef.current) return
    holdingRef.current = false
    stopFireLoop()
    try {
      arenaRef.current?.releasePointerCapture?.(event.pointerId)
    } catch {
      /* 已釋放 */
    }
  }

  // 離開 playing（結算/卸載）一律停下連發迴圈，避免視覺鎖脫鉤。
  useEffect(() => {
    if (phase !== 'playing') {
      holdingRef.current = false
      stopFireLoop()
    }
    return () => stopFireLoop()
  }, [phase])

  return (
    <div
      ref={arenaRef}
      className="fishing-arena"
      style={{ touchAction: 'none', userSelect: 'none' }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onPointerLeave={handlePointerUp}
      onContextMenu={(event) => event.preventDefault()}
    >
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
            data-fish-id={fish.id}
            className={`fishing-fish${fish.tier === 'boss' ? ' fishing-fish--boss' : ''}${fish.caught ? ' fishing-fish--caught' : ''}`}
            style={{ width: `${fish.size}px`, height: `${fish.size}px` }}
            // 滑鼠/觸控的開火統一交給 arena 的 pointer 連發；此處只接鍵盤 Enter/Space（detail===0）做無障礙開火
            onClick={(event) => {
              if (event.detail === 0) engageFish(fish)
            }}
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
