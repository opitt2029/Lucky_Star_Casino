import RankPlayerAvatar from './RankPlayerAvatar'

function secondaryText(row) {
  if (row.roundCount != null) {
    const winRate = row.winRate == null ? '-' : `${Number(row.winRate).toFixed(1)}%`
    return `${Number(row.roundCount).toLocaleString()} 局 · 勝率 ${winRate}`
  }
  return row.trend || `玩家 ID ${row.playerId ?? row.id}`
}

export default function LeaderboardPanel({
  rows = [],
  myPlayerId = '',
  limit = 100,
  loading = false,
  searchQuery = '',
  onSelectPlayer,
}) {
  const displayRows = rows.slice(0, limit)

  return (
    <section className="luxury-panel-soft rounded p-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="gold-muted text-xs font-black uppercase tracking-[0.3em]">Realtime Rank</p>
          <h2 className="brand-title mt-1 text-xl font-black">即時排行榜</h2>
        </div>
        <span className="rounded-full border border-yellow-200/20 bg-red-950/70 px-3 py-1 text-xs font-black text-yellow-100/70">
          {displayRows.length.toLocaleString()} 筆
        </span>
      </div>

      {loading && displayRows.length === 0 && (
        <div className="mt-4 grid gap-2" role="status" aria-live="polite">
          {Array.from({ length: 6 }, (_, index) => (
            <div key={index} className="h-20 animate-pulse rounded border border-yellow-200/10 bg-red-950/60" />
          ))}
        </div>
      )}

      {!loading && displayRows.length === 0 && (
        <p className="mt-4 rounded border border-yellow-200/15 bg-red-950/70 p-5 text-sm font-bold text-yellow-100/64">
          {searchQuery ? '沒有符合搜尋條件的玩家。' : '目前排行榜沒有資料。'}
        </p>
      )}

      {displayRows.length > 0 && (
        <div className="mt-4 space-y-2">
          {displayRows.map((row, index) => {
            const id = row.playerId ?? row.id
            const isMe = myPlayerId && String(id) === String(myPlayerId)
            return (
              <button
                key={id}
                type="button"
                onClick={() => onSelectPlayer?.(row)}
                className={[
                  'rank-row-enter grid w-full grid-cols-[auto_auto_minmax(0,1fr)_auto] items-center gap-3 rounded border p-3 text-left transition focus:outline-none focus:ring-2 focus:ring-yellow-200/70',
                  isMe ? 'border-yellow-200/70 bg-yellow-200 text-red-950' : 'border-yellow-200/15 bg-red-950/70 text-yellow-100 hover:border-yellow-200/45 hover:bg-red-950/90',
                ].join(' ')}
                style={{ animationDelay: `${Math.min(index * 28, 220)}ms` }}
                aria-label={`查看 ${row.nickname} 的公開排行榜資訊`}
              >
                <span className={['grid h-9 w-9 shrink-0 place-items-center rounded text-sm font-black', isMe ? 'bg-red-950 text-yellow-100' : 'bg-yellow-200 text-red-950'].join(' ')}>
                  #{row.rank || '-'}
                </span>
                <RankPlayerAvatar player={row} size="sm" />
                <span className="min-w-0">
                  <span className={['block truncate font-black', isMe ? 'text-red-950' : 'text-yellow-100'].join(' ')}>{row.nickname}</span>
                  <span className={['block truncate text-xs font-bold', isMe ? 'text-red-950/70' : 'text-yellow-100/56'].join(' ')}>{secondaryText(row)}</span>
                </span>
                <span className="min-w-0 text-right">
                  <span className={['block font-black', isMe ? 'text-red-950' : 'text-yellow-100'].join(' ')}>{Number(row.score || 0).toLocaleString()}</span>
                  <span className={['block text-xs font-bold', isMe ? 'text-red-950/70' : 'gold-muted'].join(' ')}>{row.scoreUnit || '星幣'}</span>
                </span>
              </button>
            )
          })}
        </div>
      )}
    </section>
  )
}
