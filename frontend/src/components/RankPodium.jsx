import RankPlayerAvatar from './RankPlayerAvatar'

function PodiumCard({ row, place, onSelect }) {
  if (!row) return null
  const isFirst = place === 1
  return (
    <button
      type="button"
      onClick={() => onSelect(row)}
      className={[
        'relative grid min-w-0 gap-2 rounded border bg-red-950/76 p-4 text-center transition hover:-translate-y-0.5 hover:border-yellow-200/60 focus:outline-none focus:ring-2 focus:ring-yellow-200/70',
        isFirst ? 'order-1 border-yellow-200/45 md:order-2 md:scale-105' : place === 2 ? 'order-2 border-yellow-200/25 md:order-1' : 'order-3 border-yellow-200/25',
      ].join(' ')}
    >
      {isFirst && (
        <img src="/backgrounds/rank-crown.svg" alt="" aria-hidden="true" className="pointer-events-none absolute -top-7 left-1/2 h-12 -translate-x-1/2" />
      )}
      <span className="mx-auto rounded-full bg-yellow-200 px-3 py-1 text-xs font-black text-red-950">#{row.rank || place}</span>
      <RankPlayerAvatar player={row} size={isFirst ? 'xl' : 'lg'} className="mx-auto" />
      <span className="truncate font-black text-yellow-100">{row.nickname}</span>
      <span className="text-sm font-black text-yellow-200">{Number(row.score || 0).toLocaleString()} {row.scoreUnit}</span>
    </button>
  )
}

export default function RankPodium({ rows = [], onSelect }) {
  const top = rows.slice(0, 3)
  if (top.length === 0) return null
  return (
    <section className="grid gap-3 md:grid-cols-3 md:items-end" aria-label="前三名頒獎台">
      <PodiumCard row={top[1]} place={2} onSelect={onSelect} />
      <PodiumCard row={top[0]} place={1} onSelect={onSelect} />
      <PodiumCard row={top[2]} place={3} onSelect={onSelect} />
    </section>
  )
}
