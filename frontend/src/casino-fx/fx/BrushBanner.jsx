import { useEffect, useState } from 'react'
import '../casino-fx.css'

let bannerSeq = 0

// 毛筆字大字報：「恭喜發財」「大吉大利」「暴富」「爆機」等巨大書法字 + 金光掃過。
// level: 1 小贏 / 2 大贏 / 3 爆機（越高越大、越誇張）。
// 用法：trigger 遞增觸發，text 為當次文案。
export default function BrushBanner({ trigger = 0, text = '恭喜發財', level = 1 }) {
  const [banner, setBanner] = useState(null)

  useEffect(() => {
    if (!trigger) return undefined
    bannerSeq += 1
    const id = bannerSeq
    setBanner({ id, text, level })
    const timer = window.setTimeout(() => {
      setBanner((current) => (current?.id === id ? null : current))
    }, level >= 3 ? 3200 : 2200)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trigger])

  if (!banner) return null

  return (
    <div className="fx-layer" aria-hidden="true">
      <div className={`fx-brush-banner fx-brush-banner--level-${banner.level}`}>
        <span className="fx-brush-banner__text">{banner.text}</span>
        <span className="fx-brush-banner__sheen" />
      </div>
    </div>
  )
}

// 依倍率挑選文案與等級（老虎機 / 通用派彩可直接用）。
export function pickBannerForMultiplier(multiplier) {
  if (multiplier >= 8) return { text: '爆機', level: 3 }
  if (multiplier >= 5) return { text: '暴富', level: 2 }
  if (multiplier >= 3) return { text: '大吉大利', level: 2 }
  return { text: '恭喜發財', level: 1 }
}
