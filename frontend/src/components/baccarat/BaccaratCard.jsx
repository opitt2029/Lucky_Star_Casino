import { useEffect, useRef, useState } from 'react'
import { soundEngine } from '../../casino-fx/sound/SoundEngine'

const suitSymbols = {
  spade: '♠',
  heart: '♥',
  diamond: '♦',
  club: '♣',
}

const redSuits = new Set(['heart', 'diamond'])
const SQUEEZE_HOLD_MS = 1200

export default function BaccaratCard({ card, index = 0, isDealing = false }) {
  const isRed = card && redSuits.has(card.suit)

  return (
    <div
      className={[
        'baccarat-card',
        card ? 'baccarat-card--face' : 'baccarat-card--back',
        isRed ? 'baccarat-card--red' : 'baccarat-card--black',
        isDealing || card ? 'baccarat-card--dealt' : '',
      ].join(' ')}
      style={{ animationDelay: `${index * 90}ms` }}
    >
      {card ? (
        <>
          <span className="baccarat-card__corner baccarat-card__corner--top">{card.rank}</span>
          <span className="baccarat-card__suit">{suitSymbols[card.suit]}</span>
          <span className="baccarat-card__corner baccarat-card__corner--bottom">{card.rank}</span>
        </>
      ) : (
        <span className="baccarat-card__back-mark">LS</span>
      )}
    </div>
  )
}

export function BaccaratSqueezeCard({ card, index = 0, onRevealed }) {
  const [progress, setProgress] = useState(0)
  const timerRef = useRef(null)
  const progressRef = useRef(0)
  const revealedRef = useRef(false)

  useEffect(() => () => window.clearInterval(timerRef.current), [])

  const finishReveal = () => {
    if (revealedRef.current) return
    revealedRef.current = true
    window.clearInterval(timerRef.current)
    progressRef.current = 1
    setProgress(1)
    soundEngine.play('cardFlip')
    onRevealed?.()
  }

  const startSqueeze = () => {
    if (revealedRef.current) return
    window.clearInterval(timerRef.current)
    soundEngine.play('cardRub')
    timerRef.current = window.setInterval(() => {
      progressRef.current = Math.min(progressRef.current + 50 / SQUEEZE_HOLD_MS, 1)
      setProgress(progressRef.current)
      if (Math.random() < 0.3) soundEngine.play('cardRub', { volume: 0.6 })
      if (progressRef.current >= 1) finishReveal()
    }, 50)
  }

  const stopSqueeze = () => {
    window.clearInterval(timerRef.current)
  }

  return (
    <button
      type="button"
      className="baccarat-squeeze"
      onPointerDown={startSqueeze}
      onPointerUp={stopSqueeze}
      onPointerCancel={stopSqueeze}
      onPointerLeave={stopSqueeze}
      onContextMenu={(event) => event.preventDefault()}
      aria-label="長按咪牌"
    >
      <div className="baccarat-squeeze__back">
        <BaccaratCard card={null} index={index} />
      </div>
      <div
        className="baccarat-squeeze__face"
        style={{ clipPath: `polygon(0 ${100 - progress * 100}%, 100% ${92 - progress * 92}%, 100% 100%, 0 100%)` }}
      >
        <BaccaratCard card={card} index={index} />
      </div>
      {progress < 1 && <span className="baccarat-squeeze__hint">長按咪牌</span>}
    </button>
  )
}
