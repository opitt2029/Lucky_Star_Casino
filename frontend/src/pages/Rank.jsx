import { useEffect, useMemo, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import AppShell from '../components/AppShell'
import LeaderboardPanel from '../components/LeaderboardPanel'
import MetricCard from '../components/MetricCard'
import { fetchRanks, setRankSearchQuery, setRankTab } from '../store/slices/rankSlice'

export default function Rank() {
  const dispatch = useDispatch()
  const [showFullRank, setShowFullRank] = useState(false)
  const { globalRank, friendRank, myGlobalRank, activeTab, searchQuery, error } = useSelector((state) => state.rank)
  const player = useSelector((state) => state.auth.player)
  const rows = activeTab === 'friends' ? friendRank : globalRank
  const filteredRows = useMemo(
    () => rows.filter((row) => (row.nickname || row.name).toLowerCase().includes(searchQuery.toLowerCase())),
    [rows, searchQuery]
  )
  const topScore = globalRank[0]?.score || 0
  const rankLimit = showFullRank ? 100 : 20
  const canShowMore = filteredRows.length > rankLimit

  useEffect(() => {
    dispatch(fetchRanks())
  }, [dispatch])

  useEffect(() => {
    setShowFullRank(false)
  }, [activeTab, searchQuery])

  return (
    <AppShell>
      <section className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <div className="grid gap-4">
          <section className="luxury-panel-soft rounded p-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div className="flex rounded border border-yellow-200/15 bg-red-950/70 p-1">
                {[
                  ['global', '全服 TOP100'],
                  ['friends', '好友榜'],
                ].map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => dispatch(setRankTab(key))}
                    className={[
                      'rounded px-4 py-2 text-sm font-black transition',
                      activeTab === key ? 'gold-button' : 'text-yellow-100/62 hover:text-yellow-100',
                    ].join(' ')}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <input
                className="min-h-11 rounded border border-yellow-200/15 bg-red-950/70 px-4 text-sm font-bold text-white outline-none focus:border-yellow-200"
                placeholder="搜尋好友名次"
                value={searchQuery}
                onChange={(event) => dispatch(setRankSearchQuery(event.target.value))}
              />
            </div>
            {error && <p className="mt-3 rounded border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm font-bold text-red-200">{error}</p>}
          </section>
          <LeaderboardPanel rows={filteredRows} myNickname={player?.nickname} limit={rankLimit} />
          {canShowMore && (
            <button
              type="button"
              onClick={() => setShowFullRank(true)}
              className="gold-button justify-self-center rounded px-6 py-3 text-sm font-black transition"
            >
              顯示更多
            </button>
          )}
        </div>
        <aside className="grid gap-4 content-start">
          <MetricCard label="榜首分數" value={topScore.toLocaleString()} tone="light" />
          <MetricCard label="我的名次" value={myGlobalRank?.rank ? `#${myGlobalRank.rank}` : '-'} caption={player?.nickname || '目前玩家'} />
          <MetricCard label="榜單筆數" value={filteredRows.length.toLocaleString()} caption={activeTab === 'friends' ? '好友榜' : '全服 TOP100'} />
        </aside>
      </section>
    </AppShell>
  )
}
