import { useEffect, useRef, useState } from 'react'

// 數字滾動元件：餘額 / 派彩 / Jackpot 用。value 變動時以 easeOut 滾到新值，
// 數字「跳動成長」本身就是多巴胺回饋的一環。
export default function CountUp({ value, duration = 900, className, prefix = '', suffix = '' }) {
  const [display, setDisplay] = useState(value)
  const fromRef = useRef(value)
  const rafRef = useRef(null)

  useEffect(() => {
    const from = fromRef.current
    if (from === value) return undefined
    const start = window.performance.now()

    const step = (now) => {
      const progress = Math.min((now - start) / duration, 1)
      const eased = 1 - (1 - progress) ** 3
      const current = Math.round(from + (value - from) * eased)
      setDisplay(current)
      if (progress < 1) {
        rafRef.current = window.requestAnimationFrame(step)
      } else {
        fromRef.current = value
      }
    }

    rafRef.current = window.requestAnimationFrame(step)
    return () => window.cancelAnimationFrame(rafRef.current)
  }, [value, duration])

  return (
    <span className={className}>
      {prefix}
      {Number(display).toLocaleString()}
      {suffix}
    </span>
  )
}
