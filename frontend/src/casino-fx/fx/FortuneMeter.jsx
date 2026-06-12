import '../casino-fx.css'

// 幸運值蓄力條 UI：搭配 useFortuneMeter 使用。滿格時金光脈動。
export default function FortuneMeter({ value = 0, label = '幸運值' }) {
  const full = value >= 100
  return (
    <div className={['fx-fortune-meter', full ? 'fx-fortune-meter--full' : ''].join(' ')}>
      <div className="fx-fortune-meter__head">
        <span>{label}</span>
        <strong>{full ? 'MAX 鴻運當頭' : `${Math.round(value)}%`}</strong>
      </div>
      <div className="fx-fortune-meter__track">
        <div className="fx-fortune-meter__fill" style={{ width: `${Math.min(value, 100)}%` }} />
      </div>
    </div>
  )
}
