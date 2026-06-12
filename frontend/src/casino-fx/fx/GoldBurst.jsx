import { useEffect, useState } from 'react'
import Art from '../assets/Art'
import '../casino-fx.css'

let burstSeq = 0

// 金幣噴發：從 origin（百分比座標）向四周炸開再受重力下墜。
// 用法：trigger 傳遞遞增數字（每次中獎 +1），origin 預設畫面中心。
export default function GoldBurst({ trigger = 0, origin = { x: 50, y: 55 }, count = 18 }) {
  const [bursts, setBursts] = useState([])

  useEffect(() => {
    if (!trigger) return undefined
    burstSeq += 1
    const id = burstSeq
    const particles = Array.from({ length: count }, (_, i) => {
      const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.5
      const speed = 90 + Math.random() * 180
      return {
        key: `${id}-${i}`,
        style: {
          '--burst-x': `${origin.x}%`,
          '--burst-y': `${origin.y}%`,
          '--burst-dx': `${Math.cos(angle) * speed}px`,
          '--burst-dy': `${Math.sin(angle) * speed}px`,
          '--burst-size': `${12 + Math.random() * 18}px`,
          '--burst-delay': `${Math.random() * 0.12}s`,
          '--burst-duration': `${0.9 + Math.random() * 0.5}s`,
          '--burst-spin': Math.random() > 0.5 ? 1 : -1,
        },
      }
    })
    setBursts((prev) => [...prev, { id, particles }])
    const timer = window.setTimeout(() => {
      setBursts((prev) => prev.filter((burst) => burst.id !== id))
    }, 1700)
    return () => window.clearTimeout(timer)
    // origin/count 變動不需重炸，只跟著 trigger 走
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trigger])

  if (bursts.length === 0) return null

  return (
    <div className="fx-layer" aria-hidden="true">
      {bursts.flatMap((burst) =>
        burst.particles.map((particle) => (
          <span key={particle.key} className="fx-gold-burst__coin" style={particle.style}>
            <Art id="coin" />
          </span>
        ))
      )}
    </div>
  )
}
