import { useCallback, useRef, useState } from 'react'

// 連輸吉兆氛圍（純表現層）：連續未中達門檻時開啟 LuckyAura，中獎即關閉。
// 不累積、不影響任何後端機率；僅供視覺撫慰。
const LOSS_STREAK_FOR_AURA = 4

export function useLuckyAura(threshold = LOSS_STREAK_FOR_AURA) {
  const lossStreakRef = useRef(0)
  const [auraActive, setAuraActive] = useState(false)

  // 回報該局輸贏：贏則歸零並關吉兆；連輸達門檻開吉兆。
  const reportRound = useCallback(
    (won) => {
      if (won) {
        lossStreakRef.current = 0
        setAuraActive(false)
      } else {
        lossStreakRef.current += 1
        if (lossStreakRef.current >= threshold) setAuraActive(true)
      }
    },
    [threshold],
  )

  return { auraActive, reportRound }
}
