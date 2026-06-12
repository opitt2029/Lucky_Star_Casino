import '../casino-fx.css'

// 「吉兆」氛圍層：連輸後切入的紫氣 + 金光環繞（純表現層心理撫慰，不影響後端結果）。
// active 為 true 時淡入，false 淡出。
export default function LuckyAura({ active = false }) {
  return <div className={['fx-lucky-aura', active ? 'fx-lucky-aura--active' : ''].join(' ')} aria-hidden="true" />
}
