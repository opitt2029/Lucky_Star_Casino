import { useEffect, useMemo, useState } from 'react'
import './InteractiveGameBackdrop.css'

const PARTICLE_COUNT = 18
const TRACK_COUNT = 7

const THEME_LABELS = {
  slot: 'slot interactive background',
  baccarat: 'baccarat interactive background',
  fishing: 'fishing interactive background',
}

function buildItems(count, prefix) {
  return Array.from({ length: count }, (_, index) => `${prefix}-${index}`)
}

export default function InteractiveGameBackdrop({ theme = 'slot', active = false }) {
  const [pointer, setPointer] = useState({ x: 50, y: 35, pressed: false })
  const particles = useMemo(() => buildItems(PARTICLE_COUNT, theme), [theme])
  const tracks = useMemo(() => buildItems(TRACK_COUNT, `${theme}-track`), [theme])

  useEffect(() => {
    const updatePointer = (event) => {
      const point = event.touches?.[0] || event
      const width = window.innerWidth || 1
      const height = window.innerHeight || 1
      setPointer({
        x: Math.max(0, Math.min(100, (point.clientX / width) * 100)),
        y: Math.max(0, Math.min(100, (point.clientY / height) * 100)),
        pressed: event.type === 'pointerdown' || event.type === 'touchstart',
      })
    }
    const releasePointer = () => setPointer((current) => ({ ...current, pressed: false }))

    window.addEventListener('pointermove', updatePointer, { passive: true })
    window.addEventListener('pointerdown', updatePointer, { passive: true })
    window.addEventListener('pointerup', releasePointer, { passive: true })
    window.addEventListener('touchstart', updatePointer, { passive: true })
    window.addEventListener('touchmove', updatePointer, { passive: true })
    window.addEventListener('touchend', releasePointer, { passive: true })

    return () => {
      window.removeEventListener('pointermove', updatePointer)
      window.removeEventListener('pointerdown', updatePointer)
      window.removeEventListener('pointerup', releasePointer)
      window.removeEventListener('touchstart', updatePointer)
      window.removeEventListener('touchmove', updatePointer)
      window.removeEventListener('touchend', releasePointer)
    }
  }, [])

  return (
    <div
      className={[
        'game-interactive-backdrop',
        `game-interactive-backdrop--${theme}`,
        active ? 'is-active' : '',
        pointer.pressed ? 'is-pressed' : '',
      ].filter(Boolean).join(' ')}
      style={{ '--pointer-x': `${pointer.x}%`, '--pointer-y': `${pointer.y}%` }}
      aria-label={THEME_LABELS[theme] || THEME_LABELS.slot}
      aria-hidden="true"
    >
      <div className="game-interactive-backdrop__glow" />
      <div className="game-interactive-backdrop__tracks">
        {tracks.map((item) => <span key={item} />)}
      </div>
      <div className="game-interactive-backdrop__particles">
        {particles.map((item) => <span key={item} />)}
      </div>
      <div className="game-interactive-backdrop__ripple" />
    </div>
  )
}