import { useCallback, useEffect, useState } from 'react'
import AppShell from '../components/AppShell'
import { gameApi } from '../services/gameApi'

const PAGE_SIZE = 10

const gameTypeOptions = [
  ['all', '全部'],
  ['SLOT', '老虎機'],
  ['BACCARAT', '百家樂'],
  ['FISHING', '捕魚機'],
]

const gameTypeLabels = {
  SLOT: '老虎機',
  BACCARAT: '百家樂',
  FISHING: '捕魚機',
}

function pad(value, length = 2) {
  return String(value).padStart(length, '0')
}

// 毫秒精度時間戳（下注 / 派彩時間需求）。
function formatTimestamp(iso) {
  if (!iso) return '-'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '-'
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`
  )
}

function formatCoins(value) {
  return value === null || value === undefined ? '-' : Number(value).toLocaleString()
}

function formatSignedCoins(value) {
  if (value === null || value === undefined) return '-'
  const n = Number(value)
  return `${n >= 0 ? '+' : '-'}${Math.abs(n).toLocaleString()}`
}

export default function GameHistory() {
  const [gameType, setGameType] = useState('all')
  const [page, setPage] = useState(1)
  const [rows, setRows] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const totalPages = Math.max(Math.ceil(total / PAGE_SIZE), 1)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await gameApi.gameHistory({ gameType, page, pageSize: PAGE_SIZE })
      setRows(result.items || [])
      setTotal(result.total || 0)
    } catch (err) {
      setError(err?.response?.data?.message || err.message || '讀取遊戲紀錄失敗')
      setRows([])
      setTotal(0)
    } finally {
      setLoading(false)
    }
  }, [gameType, page])

  useEffect(() => {
    load()
  }, [load])

  // 切換遊戲類型時回到第一頁。
  const handleGameTypeChange = (value) => {
    setGameType(value)
    setPage(1)
  }

  return (
    <AppShell>
      <section className="luxury-panel rounded p-4">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
          <div>
            <p className="gold-muted text-xs font-black uppercase tracking-[0.3em]">Game History</p>
            <h2 className="brand-title mt-1 text-2xl font-black">遊戲紀錄</h2>
            <p className="mt-1 text-sm font-bold text-yellow-100/60">
              每筆注單保留流水號、局號、毫秒下注/派彩時間與「投注前 → 派彩後」餘額變化。
            </p>
          </div>
          <button
            type="button"
            onClick={load}
            className="gold-button rounded px-4 py-2 text-sm font-black transition"
          >
            {loading ? '更新中...' : '更新紀錄'}
          </button>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-[220px]">
          <select
            className="min-h-11 rounded border border-yellow-200/15 bg-red-950/70 px-4 text-sm font-bold text-white outline-none focus:border-yellow-200"
            value={gameType}
            onChange={(event) => handleGameTypeChange(event.target.value)}
          >
            {gameTypeOptions.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        {error && <p className="mt-3 rounded border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm font-bold text-red-200">{error}</p>}

        {/* 手機版：卡片列表 */}
        <div className="mt-5 grid gap-3 lg:hidden">
          {rows.map((row) => (
            <article key={row.roundId} className="rounded border border-yellow-200/15 bg-red-950/70 p-4 text-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="gold-muted text-xs font-black uppercase tracking-[0.2em]">注單號</p>
                  <p className="mt-1 break-all font-black text-yellow-100">{row.roundId}</p>
                </div>
                <span className="shrink-0 rounded border border-yellow-200/15 px-2 py-1 text-xs font-black text-yellow-100/72">
                  {gameTypeLabels[row.gameType] || row.gameType}
                </span>
              </div>
              <dl className="mt-4 grid gap-2">
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-yellow-100/62">局號</dt>
                  <dd className="font-bold text-yellow-100/80">{row.nonce ?? '-'}</dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-yellow-100/62">投注 / 派彩</dt>
                  <dd className="font-bold text-yellow-100/80">
                    {formatCoins(row.betAmount)} / {formatCoins(row.winAmount)}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-yellow-100/62">損益</dt>
                  <dd className={['font-black', (row.profit ?? 0) >= 0 ? 'text-emerald-300' : 'text-red-300'].join(' ')}>
                    {formatSignedCoins(row.profit)}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-yellow-100/62">餘額變化</dt>
                  <dd className="text-right font-bold text-yellow-100/80">
                    {formatCoins(row.balanceBefore)} → {formatCoins(row.balanceAfter)}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-yellow-100/62">下注時間</dt>
                  <dd className="text-right font-bold text-yellow-100/60">{formatTimestamp(row.betAt)}</dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-yellow-100/62">派彩時間</dt>
                  <dd className="text-right font-bold text-yellow-100/60">{formatTimestamp(row.settledAt)}</dd>
                </div>
              </dl>
            </article>
          ))}
          {rows.length === 0 && (
            <p className="rounded border border-yellow-200/15 bg-red-950/70 px-3 py-8 text-center font-bold text-yellow-100/56">
              沒有符合條件的遊戲紀錄
            </p>
          )}
        </div>

        {/* 桌機版：表格 */}
        <div className="mt-5 hidden overflow-x-auto lg:block">
          <table className="w-full border-separate border-spacing-y-2 text-left text-sm">
            <thead className="gold-muted text-xs uppercase tracking-[0.2em]">
              <tr>
                <th className="px-3 py-2">注單號</th>
                <th className="px-3 py-2">遊戲</th>
                <th className="px-3 py-2">局號</th>
                <th className="px-3 py-2">投注</th>
                <th className="px-3 py-2">派彩</th>
                <th className="px-3 py-2">損益</th>
                <th className="px-3 py-2">投注前 → 派彩後</th>
                <th className="px-3 py-2">下注時間</th>
                <th className="px-3 py-2">派彩時間</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.roundId} className="bg-red-950/70">
                  <td className="rounded-l border-y border-l border-yellow-200/15 px-3 py-3 font-black text-yellow-100">
                    <span className="block max-w-[160px] truncate" title={row.roundId}>{row.roundId}</span>
                  </td>
                  <td className="border-y border-yellow-200/15 px-3 py-3 text-yellow-100/72">
                    {gameTypeLabels[row.gameType] || row.gameType}
                  </td>
                  <td className="border-y border-yellow-200/15 px-3 py-3 text-yellow-100/72">{row.nonce ?? '-'}</td>
                  <td className="border-y border-yellow-200/15 px-3 py-3 text-yellow-100/80">{formatCoins(row.betAmount)}</td>
                  <td className="border-y border-yellow-200/15 px-3 py-3 text-yellow-200">{formatCoins(row.winAmount)}</td>
                  <td className={['border-y border-yellow-200/15 px-3 py-3 font-black', (row.profit ?? 0) >= 0 ? 'text-emerald-300' : 'text-red-300'].join(' ')}>
                    {formatSignedCoins(row.profit)}
                  </td>
                  <td className="border-y border-yellow-200/15 px-3 py-3 text-yellow-100/70 tabular-nums">
                    {formatCoins(row.balanceBefore)} → {formatCoins(row.balanceAfter)}
                  </td>
                  <td className="border-y border-yellow-200/15 px-3 py-3 text-yellow-100/60 tabular-nums">{formatTimestamp(row.betAt)}</td>
                  <td className="rounded-r border-y border-r border-yellow-200/15 px-3 py-3 text-yellow-100/60 tabular-nums">{formatTimestamp(row.settledAt)}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr className="bg-red-950/70">
                  <td colSpan="9" className="rounded border border-yellow-200/15 px-3 py-8 text-center font-bold text-yellow-100/56">
                    沒有符合條件的遊戲紀錄
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="gold-muted text-sm font-bold">
            第 {page} / {totalPages} 頁，共 {total} 筆
          </p>
          <div className="grid grid-cols-2 gap-2 sm:flex">
            <button
              type="button"
              onClick={() => setPage((prev) => Math.max(prev - 1, 1))}
              disabled={page <= 1}
              className="red-gold-button rounded px-4 py-2 text-sm font-black disabled:cursor-not-allowed disabled:opacity-40"
            >
              上一頁
            </button>
            <button
              type="button"
              onClick={() => setPage((prev) => Math.min(prev + 1, totalPages))}
              disabled={page >= totalPages}
              className="red-gold-button rounded px-4 py-2 text-sm font-black disabled:cursor-not-allowed disabled:opacity-40"
            >
              下一頁
            </button>
          </div>
        </div>
      </section>
    </AppShell>
  )
}
