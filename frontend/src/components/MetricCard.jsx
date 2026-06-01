export default function MetricCard({ label, value, caption, tone = 'dark' }) {
  const isLight = tone === 'light'

  return (
    <div
      className={[
        'rounded border p-4',
        isLight ? 'gold-button text-red-950' : 'luxury-panel-soft text-white',
      ].join(' ')}
    >
      <p className={['text-xs font-black uppercase tracking-[0.25em]', isLight ? 'text-red-950/68' : 'gold-muted'].join(' ')}>
        {label}
      </p>
      <p className="mt-3 text-2xl font-black tracking-tight">{value}</p>
      {caption ? <p className={['mt-2 text-sm', isLight ? 'text-red-950/72' : 'text-yellow-100/62'].join(' ')}>{caption}</p> : null}
    </div>
  )
}
