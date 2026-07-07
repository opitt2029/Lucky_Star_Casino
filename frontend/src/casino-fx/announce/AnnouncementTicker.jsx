import { useEffect, useRef, useState } from 'react'
import { soundEngine } from '../sound/SoundEngine'
import { subscribeAnnouncements, announcePlayerWin } from './announceBus'
import { CoinRainPro } from '../fx/FallRain'
import { useSitePreferences } from '../../utils/sitePreferences'
import '../casino-fx.css'

export default function AnnouncementTicker() {
  const [current, setCurrent] = useState(null)
  const [coinTrigger, setCoinTrigger] = useState(0)
  const [preferences] = useSitePreferences()
  const queueRef = useRef([])
  const busyRef = useRef(false)

  useEffect(() => {
    if (!preferences.announcementsEnabled) {
      queueRef.current = []
      busyRef.current = false
      setCurrent(null)
      return undefined
    }

    const timers = new Set()
    const schedule = (callback, delay) => {
      const timer = window.setTimeout(() => {
        timers.delete(timer)
        callback()
      }, delay)
      timers.add(timer)
    }

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
      schedule(showNext, next.big ? 7600 : 6200)
    }

    const unsubscribe = subscribeAnnouncements((announcement) => {
      if (queueRef.current.length >= 4) queueRef.current.shift()
      queueRef.current.push(announcement)
      if (!busyRef.current) showNext()
    })

    return () => {
      unsubscribe()
      timers.forEach((timer) => window.clearTimeout(timer))
      queueRef.current = []
      busyRef.current = false
      setCurrent(null)
    }
  }, [preferences.announcementsEnabled])

  if (!preferences.announcementsEnabled) return null

  return (
    <>
      {preferences.backgroundEffectsEnabled && <CoinRainPro trigger={coinTrigger} density="light" />}
      {current && (
        <div className={['fx-ticker', current.big ? 'fx-ticker--big' : ''].join(' ')} role="status">
          <span className="fx-ticker__icon" aria-hidden="true">★</span>
          <div className="fx-ticker__viewport">
            <span className="fx-ticker__text">全網公告：{current.text}</span>
          </div>
        </div>
      )}
    </>
  )
}

export { announcePlayerWin }
