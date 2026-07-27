export default function LeaderboardPanel({ rows = [], myNickname = '', limit = 10 }) {
  const displayRows = rows.slice(0, limit)

  return (
    <section className="luxury-panel-soft rounded p-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="gold-muted text-xs font-black uppercase tracking-[0.3em]">Realtime Rank</p>
          <h2 className="brand-title mt-1 text-xl font-black">即時排行榜</h2>
        </div>
      </div>

      {displayRows.length === 0 ? (
        <div className="mt-4 rounded border border-yellow-200/15 bg-red-950/55 px-4 py-8 text-center">
          <p className="font-black text-yellow-100">目前尚無排行榜資料</p>
          <p className="mt-2 text-sm font-bold text-yellow-100/56">完成遊戲紀錄後，名次會顯示在這裡。</p>
        </div>
      ) : (
        <div className="mt-4 space-y-2">
          {displayRows.map((row, index) => {
            const nickname = row.nickname || row.name || '未命名玩家'
            const isMe = myNickname && nickname === myNickname
            const displayedRank = row.rank ?? index + 1
            const score = Number(row.score) || 0

            return (
              <div
                key={row.id || `${nickname}-${displayedRank}`}
                className={[
                  'grid grid-cols-[auto_1fr_auto] items-center gap-3 rounded border p-3',
                  isMe ? 'gold-button text-red-950' : 'border-yellow-200/15 bg-red-950/70',
                ].join(' ')}
              >
                <span className="grid h-8 w-8 place-items-center rounded bg-yellow-200 text-sm font-black text-red-950">
                  {displayedRank}
                </span>
                <div className="min-w-0">
                  <p className={['truncate font-black', isMe ? 'text-red-950' : 'text-yellow-100'].join(' ')}>
                    {nickname}
                  </p>
                  <p className={['text-xs', isMe ? 'text-red-950/70' : 'text-yellow-100/56'].join(' ')}>
                    今日累積贏分
                  </p>
                </div>
                <div className="min-w-0 text-right">
                  <p className={['font-black', isMe ? 'text-red-950' : 'text-yellow-100'].join(' ')}>
                    {score.toLocaleString()}
                  </p>
                  {row.trend && (
                    <p className={['text-xs font-bold', isMe ? 'text-red-950/70' : 'gold-muted'].join(' ')}>
                      {row.trend}
                    </p>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
