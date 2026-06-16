import { useCallback, useEffect, useRef, useState } from 'react'

// 幸運值蓄力條（表現層）：隨下注累積、中大獎時釋放。
// 給玩家「蓄力快滿了」的掌控感與期待感；不影響任何後端機率。
// 連輸計數同時供 LuckyAura（吉兆氛圍）使用。
const STORAGE_PREFIX = 'lucky-star-fortune-v1:'
const LOSS_STREAK_FOR_AURA = 4

export function useFortuneMeter(gameKey) {
  const storageKey = `${STORAGE_PREFIX}${gameKey}`
  const [value, setValue] = useState(() => {
    try {
      const raw = localStorage.getItem(storageKey)
      const parsed = raw ? Number(raw) : 0
      return Number.isFinite(parsed) ? Math.min(Math.max(parsed, 0), 100) : 0
    } catch {
      return 0
    }
  })
  const lossStreakRef = useRef(0)
  const [auraActive, setAuraActive] = useState(false)

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, String(value))
    } catch {
      // 忽略儲存失敗
    }
  }, [storageKey, value])

  // 每次下注累積幸運值；下注越大蓄越快（上限 100）。
  const addCharge = useCallback((betAmount) => {
    const gain = Math.max(2, Math.min(12, Math.round(betAmount / 250)))
    setValue((prev) => Math.min(prev + gain, 100))
  }, [])

  // 回報該局輸贏：贏（payout > 0）釋放幸運值並關吉兆；連輸達門檻開吉兆。
  const reportRound = useCallback((won) => {
    if (won) {
      lossStreakRef.current = 0
      setAuraActive(false)
      setValue((prev) => (prev >= 100 ? 0 : Math.max(prev - 30, 0)))
    } else {
      lossStreakRef.current += 1
      if (lossStreakRef.current >= LOSS_STREAK_FOR_AURA) {
        setAuraActive(true)
      }
    }
  }, [])

  return { value, full: value >= 100, addCharge, reportRound, auraActive }
}
