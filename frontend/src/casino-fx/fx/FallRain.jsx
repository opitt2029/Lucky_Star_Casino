import { useEffect, useState } from 'react'
import Art from '../assets/Art'
import '../casino-fx.css'

let rainSeq = 0

const DENSITY = {
  light: { count: 26, duration: 2600 },
  heavy: { count: 70, duration: 3600 },
  // epic：金幣如瀑布傾瀉、刻意遮擋畫面的誇張渲染（爆機專用）
  // §2.3：上限 150→90，降同時動畫節點數保住 H5/手機幀率（移除 drop-shadow 後仍偏重）
  epic: { count: 90, duration: 4800 },
}

// 一次性墜落雨（金幣 / 紅包共用底層）。trigger 遞增即觸發一波，播完自動清除。
export default function FallRain({
  trigger = 0,
  artId = 'coin',
  density = 'light',
  className = '',
}) {
  const [waves, setWaves] = useState([])

  useEffect(() => {
    if (!trigger) return undefined
    rainSeq += 1
    const id = rainSeq
    const { count, duration } = DENSITY[density] || DENSITY.light
    const drops = Array.from({ length: count }, (_, i) => ({
      key: `${id}-${i}`,
      style: {
        '--rain-left': `${Math.random() * 100}%`,
        '--rain-size': `${density === 'epic' ? 22 + Math.random() * 42 : 14 + Math.random() * 26}px`,
        '--rain-delay': `${Math.random() * (duration / 1000) * 0.45}s`,
        '--rain-duration': `${1.4 + Math.random() * 1.6}s`,
        '--rain-drift': `${(Math.random() - 0.5) * 120}px`,
        '--rain-spin': Math.random() > 0.5 ? 1 : -1,
        '--rain-trail': `${26 + Math.random() * 64}px`,
        '--rain-depth': `${0.72 + Math.random() * 0.5}`,
        '--rain-flare': `${0.5 + Math.random() * 0.5}`,
      },
    }))
    setWaves((prev) => [...prev, { id, drops }])
    const timer = window.setTimeout(() => {
      setWaves((prev) => prev.filter((wave) => wave.id !== id))
    }, duration + 600)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trigger])

  if (waves.length === 0) return null

  return (
    <div className={['fx-layer', className].filter(Boolean).join(' ')} aria-hidden="true">
      {waves.flatMap((wave) =>
        wave.drops.map((drop) => (
          <span
            key={drop.key}
            className={`fx-rain__drop fx-rain__drop--${artId} fx-rain__drop--${density}`}
            style={drop.style}
          >
            <Art id={artId} />
          </span>
        ))
      )}
    </div>
  )
}

// 語意化包裝：中獎金幣雨（分級）與紅包雨。
export function CoinRainPro({ trigger, density = 'heavy', className = '' }) {
  return <FallRain trigger={trigger} artId="coin" density={density} className={className} />
}

export function RedEnvelopeRain({ trigger, density = 'heavy', className = '' }) {
  return (
    <FallRain trigger={trigger} artId="slot-red-envelope" density={density} className={className} />
  )
}
