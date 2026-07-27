// hint 傳入 <InfoHint>，會顯示在標籤旁邊；不傳就跟原本一樣，既有呼叫端不受影響。
export default function MetricCard({ label, value, caption, tone = 'dark', valueClass = '', hint = null }) {
  const isLight = tone === 'light'

  return (
    <div
      className={[
        'rounded border p-4',
        isLight ? 'gold-button text-red-950' : 'luxury-panel-soft text-white',
      ].join(' ')}
    >
      <p
        className={[
          'flex items-center gap-2 text-xs font-black uppercase tracking-[0.25em]',
          isLight ? 'text-red-950/68' : 'gold-muted',
        ].join(' ')}
      >
        {label}
        {hint}
      </p>
      <p className={['mt-3 text-2xl font-black tracking-tight tabular-nums', valueClass].filter(Boolean).join(' ')}>{value}</p>
      {caption ? <p className={['mt-2 text-sm', isLight ? 'text-red-950/72' : 'text-yellow-100/62'].join(' ')}>{caption}</p> : null}
    </div>
  )
}
