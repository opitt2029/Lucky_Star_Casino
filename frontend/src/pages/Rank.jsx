import { useEffect, useMemo, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import AppShell from '../components/AppShell'
import LeaderboardPanel from '../components/LeaderboardPanel'
import MetricCard from '../components/MetricCard'
import RankFilters, { rankCategories } from '../components/RankFilters'
import RankPlayerDrawer from '../components/RankPlayerDrawer'
import RankPodium from '../components/RankPodium'
import RankRefreshStatus from '../components/RankRefreshStatus'
import {
  clearSelectedRankPlayer,
  fetchLeaderboard,
  fetchMyRanks,
  fetchRankPlayer,
  rankKey,
  refreshActiveLeaderboard,
  setRankCategory,
  setRankScope,
  setRankSearchQuery,
} from '../store/slices/rankSlice'

const REFRESH_INTERVAL_MS = 300000

function categoryLabel(category) {
  return rankCategories.find((item) => item.key === category)?.label || category
}

export default function Rank() {
  const dispatch = useDispatch()
  const [showFullRank, setShowFullRank] = useState(false)
  const [nextRefreshIn, setNextRefreshIn] = useState(REFRESH_INTERVAL_MS)
  const {
    activeScope,
    activeCategory,
    rankings,
    myRanks,
    selectedPlayer,
    selectedPlayerId,
    searchQuery,
    loading,
    refreshing,
    playerLoading,
    lastUpdatedAt,
    error,
    myRanksError,
    playerError,
  } = useSelector((state) => state.rank)
  const player = useSelector((state) => state.auth.player)
  const activeKey = rankKey(activeScope, activeCategory)
  const rows = useMemo(() => rankings[activeKey] || [], [rankings, activeKey])
  const rankLimit = showFullRank ? 100 : 20

  const filteredRows = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    if (!query) return rows
    return rows.filter((row) => {
      const nickname = String(row.nickname || row.name || '').toLowerCase()
      const id = String(row.playerId ?? row.id ?? '').toLowerCase()
      return nickname.includes(query) || id.includes(query)
    })
  }, [rows, searchQuery])

  const visibleRows = filteredRows.slice(0, rankLimit)
  const canShowMore = filteredRows.length > rankLimit
  const topScore = rows[0]?.score || 0
  const myRank = myRanks[activeKey]

  useEffect(() => {
    dispatch(fetchLeaderboard({ scope: activeScope, category: activeCategory }))
    dispatch(fetchMyRanks())
    setShowFullRank(false)
  }, [activeScope, activeCategory, dispatch])

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return
      dispatch(refreshActiveLeaderboard())
      dispatch(fetchMyRanks())
    }, REFRESH_INTERVAL_MS)
    return () => window.clearInterval(timer)
  }, [dispatch])

  useEffect(() => {
    const tick = () => {
      if (!lastUpdatedAt) {
        setNextRefreshIn(REFRESH_INTERVAL_MS)
        return
      }
      const elapsed = Date.now() - new Date(lastUpdatedAt).getTime()
      setNextRefreshIn(REFRESH_INTERVAL_MS - (elapsed % REFRESH_INTERVAL_MS))
    }
    tick()
    const timer = window.setInterval(tick, 1000)
    return () => window.clearInterval(timer)
  }, [lastUpdatedAt])

  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState !== 'visible' || !lastUpdatedAt) return
      if (Date.now() - new Date(lastUpdatedAt).getTime() >= REFRESH_INTERVAL_MS) {
        dispatch(refreshActiveLeaderboard())
        dispatch(fetchMyRanks())
      }
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => document.removeEventListener('visibilitychange', onVisibilityChange)
  }, [dispatch, lastUpdatedAt])

  useEffect(() => {
    setShowFullRank(false)
  }, [activeScope, activeCategory, searchQuery])

  const handleRefresh = () => {
    dispatch(refreshActiveLeaderboard())
    dispatch(fetchMyRanks())
  }

  const handleSelectPlayer = (row) => {
    dispatch(
      fetchRankPlayer({
        playerId: row.playerId ?? row.id,
        scope: activeScope,
        category: activeCategory,
      }),
    )
  }

  return (
    <AppShell>
      <section className="relative mb-5 overflow-hidden rounded border border-yellow-200/20 bg-[radial-gradient(circle_at_top_left,rgba(248,200,76,0.20),transparent_34%),linear-gradient(135deg,rgba(87,6,13,0.96),rgba(16,2,4,0.96))] p-5 shadow-2xl sm:p-7">
        <img src="/backgrounds/rank-crown.svg" alt="" aria-hidden="true" className="pointer-events-none absolute right-5 top-4 h-24 opacity-25 sm:h-32" />
        <img src="/backgrounds/rank-coins.svg" alt="" aria-hidden="true" className="pointer-events-none absolute bottom-2 left-3 h-20 opacity-20 sm:h-28" />
        <img src="/backgrounds/rank-slot.svg" alt="" aria-hidden="true" className="pointer-events-none absolute bottom-5 right-32 hidden h-16 opacity-20 lg:block" />
        <div className="relative grid gap-5 lg:grid-cols-[1fr_420px] lg:items-end">
          <div>
            <p className="gold-muted text-xs font-black uppercase tracking-[0.35em]">Lucky Star Casino</p>
            <h1 className="brand-title mt-2 text-3xl font-black sm:text-5xl">幸運星排行榜</h1>
            <p className="mt-3 max-w-2xl text-sm font-bold leading-6 text-yellow-100/72">
              全服、好友、今日贏幣與三款遊戲榜每五分鐘完整同步，WebSocket 仍會即時補上全服 TOP10 變動。
            </p>
          </div>
          <RankRefreshStatus
            lastUpdatedAt={lastUpdatedAt}
            nextRefreshIn={nextRefreshIn}
            refreshing={refreshing}
            onRefresh={handleRefresh}
          />
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <div className="grid gap-4">
          <RankFilters
            scope={activeScope}
            category={activeCategory}
            onScopeChange={(value) => dispatch(setRankScope(value))}
            onCategoryChange={(value) => dispatch(setRankCategory(value))}
          />

          <section key={`rank-search-${activeKey}`} className="rank-transition-enter luxury-panel-soft rounded p-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="gold-muted text-xs font-black uppercase tracking-[0.25em]">Search</p>
                <h2 className="mt-1 text-lg font-black text-yellow-100">{activeScope === 'FRIENDS' ? '好友' : '全服'} · {categoryLabel(activeCategory)}</h2>
              </div>
              <input
                className="min-h-11 rounded border border-yellow-200/15 bg-red-950/70 px-4 text-sm font-bold text-white outline-none focus:border-yellow-200"
                placeholder="搜尋暱稱或玩家 ID"
                aria-label="搜尋排行榜玩家"
                value={searchQuery}
                onChange={(event) => dispatch(setRankSearchQuery(event.target.value))}
              />
            </div>
            {error && (
              <div className="mt-3 flex flex-col gap-3 rounded border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm font-bold text-red-200 sm:flex-row sm:items-center sm:justify-between">
                <span>{error}</span>
                <button type="button" onClick={handleRefresh} className="red-gold-button rounded px-3 py-2 text-xs font-black">重試</button>
              </div>
            )}
          </section>

          <div key={`rank-podium-${activeKey}`} className="rank-transition-shell rank-transition-enter">
            <RankPodium rows={filteredRows} onSelect={handleSelectPlayer} />
          </div>
          <div key={`rank-board-${activeKey}`} className="rank-transition-shell rank-transition-enter">
            <LeaderboardPanel
              rows={visibleRows}
              myPlayerId={player?.id}
              limit={rankLimit}
              loading={loading}
              searchQuery={searchQuery}
              onSelectPlayer={handleSelectPlayer}
            />
          </div>
          {canShowMore && (
            <div key={`rank-more-${activeKey}`} className="rank-transition-enter justify-self-center">
              <button type="button" onClick={() => setShowFullRank(true)} className="gold-button rounded px-6 py-3 text-sm font-black transition">
                顯示更多
              </button>
            </div>
          )}
        </div>
        <aside className="grid content-start gap-4">
          <MetricCard label="目前榜單" value={categoryLabel(activeCategory)} caption={activeScope === 'FRIENDS' ? '好友圈排名' : '全服排名'} tone="light" />
          <MetricCard label="榜首分數" value={Number(topScore).toLocaleString()} caption={rows[0]?.scoreUnit || '星幣'} />
          <MetricCard label="我的名次" value={myRank?.rank ? `#${myRank.rank}` : '-'} caption={myRank ? `${Number(myRank.score || 0).toLocaleString()} ${myRank.scoreUnit || ''}` : player?.nickname || '目前玩家'} />
          <MetricCard label="榜單筆數" value={filteredRows.length.toLocaleString()} caption={searchQuery ? '搜尋結果' : '目前分類'} />
          {refreshing && <p className="rounded border border-yellow-200/15 bg-red-950/70 p-3 text-sm font-bold text-yellow-100/64" aria-live="polite">排行榜資料更新中...</p>}
          {myRanksError && <p className="rounded border border-yellow-200/20 bg-yellow-200/10 p-3 text-sm font-bold text-yellow-100/72">{myRanksError}</p>}
        </aside>
      </section>

      <RankPlayerDrawer
        open={selectedPlayerId != null || playerLoading || !!playerError}
        player={selectedPlayer}
        loading={playerLoading}
        error={playerError}
        onClose={() => dispatch(clearSelectedRankPlayer())}
      />
    </AppShell>
  )
}
