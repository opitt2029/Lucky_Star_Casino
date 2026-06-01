const fallbackRows = [
  { name: 'Nova', score: 98200, trend: '+12%' },
  { name: 'AceLin', score: 87400, trend: '+9%' },
  { name: 'BlackJack', score: 72150, trend: '+5%' },
  { name: 'Mika', score: 69000, trend: '+3%' },
]

export default function LeaderboardPanel({ rows = fallbackRows, myNickname = '', limit = 10 }) {
  const displayRows = rows.length ? rows : fallbackRows

  return (
    <section className="luxury-panel-soft rounded p-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="gold-muted text-xs font-black uppercase tracking-[0.3em]">Realtime Rank</p>
          <h2 className="brand-title mt-1 text-xl font-black">即時排行榜</h2>
        </div>
      </div>

      <div className="mt-4 space-y-2">
        {displayRows.slice(0, limit).map((row, index) => {
          const nickname = row.nickname || row.name
          const isMe = myNickname && nickname === myNickname
          return (
          <div
            key={row.id || nickname}
            className={[
              'grid grid-cols-[auto_1fr_auto] items-center gap-3 rounded border p-3',
              isMe ? 'gold-button text-red-950' : 'border-yellow-200/15 bg-red-950/70',
            ].join(' ')}
          >
            <span className="grid h-8 w-8 place-items-center rounded bg-yellow-200 text-sm font-black text-red-950">{index + 1}</span>
            <div>
              <p className={['font-black', isMe ? 'text-red-950' : 'text-yellow-100'].join(' ')}>{nickname}</p>
              <p className={['text-xs', isMe ? 'text-red-950/70' : 'text-yellow-100/56'].join(' ')}>今日累積贏分</p>
            </div>
            <div className="text-right">
              <p className={['font-black', isMe ? 'text-red-950' : 'text-yellow-100'].join(' ')}>{row.score.toLocaleString()}</p>
              <p className={['text-xs font-bold', isMe ? 'text-red-950/70' : 'gold-muted'].join(' ')}>{row.trend}</p>
            </div>
          </div>
        )})}
      </div>
    </section>
  )
}
