import { useEffect } from 'react'
import { bgmComposer } from './bgmComposer'

/**
 * 播放指定主題 BGM（薄轉接層：實際編曲/排程在 bgmComposer）。
 * 主題切換走 crossfade、intensity 讓音樂隨遊戲張力增厚，皆由 composer 處理。
 *
 * 單一持有者假設：同時只會有一個遊戲頁掛載本 hook；若未來出現多個，
 * 行為定義為「後啟動者為準」（composer 是 singleton，start 會 crossfade 掉前者）。
 *
 * @param {string|null} theme  'slot' | 'baccarat' | 'fishing' | 'boss' | null（null=靜音）
 * @param {boolean} active     頁面層的總開關（離開頁面自動停）
 * @param {object} opts        { intensity?: 0|1|2 }  0=極簡 1=一般 2=高潮疊層
 */
export function useBgm(theme, active = true, opts = {}) {
  const intensity = opts.intensity ?? 1

  useEffect(() => {
    if (!theme || !active) {
      bgmComposer.stop()
      return undefined
    }
    bgmComposer.start(theme)
    return () => bgmComposer.stop()
  }, [theme, active])

  useEffect(() => {
    bgmComposer.setIntensity(intensity)
  }, [intensity])
}
