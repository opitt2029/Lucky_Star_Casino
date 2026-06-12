import { useEffect, useRef, useState } from 'react'
import { soundEngine } from '../sound/SoundEngine'
import { subscribeAnnouncements, announcePlayerWin } from './announceBus'
import { CoinRainPro } from '../fx/FallRain'
import '../casino-fx.css'

// 全服喜報滾動條：訂閱 announceBus，逐則輪播；big 喜報附帶短暫金幣微特效，
// 刺激「別人在大贏」的跟風心理。掛在 AppShell 即全站可見。
export default function AnnouncementTicker() {
  const [current, setCurrent] = useState(null)
  const [coinTrigger, setCoinTrigger] = useState(0)
  const queueRef = useRef([])
  const busyRef = useRef(false)

  useEffect(() => {
    const showNext = () => {
      const next = queueRef.current.shift()
      if (!next) {
        busyRef.current = false
        setCurrent(null)
        return
      }
      busyRef.current = true
      setCurrent(next)
      soundEngine.play('announce', { volume: next.big ? 1 : 0.6 })
      if (next.big) setCoinTrigger((n) => n + 1)
      window.setTimeout(showNext, next.big ? 7600 : 6200)
    }

    const unsubscribe = subscribeAnnouncements((announcement) => {
      // 佇列上限，避免喜報堆積過久
      if (queueRef.current.length >= 4) queueRef.current.shift()
      queueRef.current.push(announcement)
      if (!busyRef.current) showNext()
    })
    return unsubscribe
  }, [])

  return (
    <>
      <CoinRainPro trigger={coinTrigger} density="light" />
      {current && (
        <div className={['fx-ticker', current.big ? 'fx-ticker--big' : ''].join(' ')} role="status">
          <span className="fx-ticker__icon" aria-hidden="true">🎉</span>
          <div className="fx-ticker__viewport">
            <span className="fx-ticker__text">
              全服喜報：{current.text}
            </span>
          </div>
        </div>
      )}
    </>
  )
}

export { announcePlayerWin }
