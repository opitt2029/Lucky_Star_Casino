import { useCallback, useEffect, useRef, useState } from 'react'

// 幸運值蓄力條（表現層）：隨下注累積、中大獎時釋放。
// 給玩家「蓄力快滿了」的掌控感與期待感；不影響任何後端機率。
// 連輸計數同時供 LuckyAura（吉兆氛圍）使用。
const STORAGE_PREFIX = 'lucky-star-fortune-v1:'
const LOSS_STREAK_FOR_AURA = 4

function readFortuneFromStorage(key) {
  try {
    const raw = localStorage.getItem(key)
    const parsed = raw ? Number(raw) : 0
    return Number.isFinite(parsed) ? Math.min(Math.max(parsed, 0), 100) : 0
  } catch {
    return 0
  }
}

export function useFortuneMeter(gameKey, playerId) {
  const storageKey = `${STORAGE_PREFIX}${gameKey}:${playerId ?? 'guest'}`
  const [value, setValue] = useState(() => readFortuneFromStorage(storageKey))
  const lossStreakRef = useRef(0)
  const [auraActive, setAuraActive] = useState(false)

  // storageKey 以 ref 追蹤，讓寫入 effect 不因 key 變化而觸發（避免用 guest 的 0 覆蓋玩家存值）
  const prevKeyRef = useRef(storageKey)
  const storageKeyRef = useRef(storageKey)
  storageKeyRef.current = storageKey

  // auth 非同步載入：playerId 從 null 變成真實 ID 時，重新讀取對應帳號的幸運值
  useEffect(() => {
    if (prevKeyRef.current === storageKey) return
    prevKeyRef.current = storageKey
    setValue(readFortuneFromStorage(storageKey))
  }, [storageKey])

  // 只在 value 改變時寫入，透過 ref 取得當下正確的 key，避免 key 切換瞬間寫入舊值
  useEffect(() => {
    try {
      localStorage.setItem(storageKeyRef.current, String(value))
    } catch {
      // 忽略儲存失敗
    }
  }, [value])

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
