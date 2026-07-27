import { useCallback, useEffect, useMemo, useState } from 'react'
import AppShell from '../components/AppShell'
import { walletApi } from '../services/walletApi'
import { gameApi } from '../services/gameApi'

const PAGE_SIZE = 10
const FETCH_CAP = 200

const sourceOptions = [
  ['all', '全部紀錄'],
  ['transaction', '錢包交易'],
  ['game', '遊戲紀錄'],
]

const transactionTypeOptions = [
  ['all', '全部交易'],
  ['credit', '入帳'],
  ['debit', '扣款'],
]

const gameTypeOptions = [
  ['all', '全部遊戲'],
  ['SLOT', '老虎機'],
  ['BACCARAT', '百家樂'],
  ['FISHING', '捕魚機'],
]

const gameTypeLabels = {
  SLOT: '老虎機',
  BACCARAT: '百家樂',
  FISHING: '捕魚機',
}

const GAME_TX_TYPES = new Set(['bet', 'payout', 'win'])

function isGameTx(row) {
  return GAME_TX_TYPES.has(String(row.type || '').toLowerCase())
}

function formatTime(iso) {
  if (!iso) return '-'
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? '-' : date.toLocaleString()
}

function formatSigned(value) {
  if (value === null || value === undefined) return '-'
  const n = Number(value)
  return `${n > 0 ? '+' : ''}${n.toLocaleString()}`
}

function formatBalance(value) {
  return value === null || value === undefined ? '-' : Number(value).toLocaleString()
}

function rowInDateRange(row, startDate, endDate) {
  if (!startDate && !endDate) return true
  if (!row.time) return false

  const time = new Date(row.time).getTime()
  if (Number.isNaN(time)) return false

  if (startDate && time < new Date(`${startDate}T00:00:00`).getTime()) return false
  if (endDate && time > new Date(`${endDate}T23:59:59.999`).getTime()) return false
  return true
}

function txToRow(tx) {
  return {
    key: `tx-${tx.id}`,
    time: tx.createdAt,
    source: 'transaction',
    sourceLabel: '錢包',
    typeLabel: tx.typeLabel,
    amount: tx.amount,
    balanceAfter: null,
  }
}

function gameToRow(g) {
  return {
    key: `game-${g.roundId}`,
    time: g.settledAt || g.betAt,
    source: 'game',
    sourceLabel: '遊戲',
    typeLabel: gameTypeLabels[g.gameType] || g.gameType,
    amount: g.profit,
    balanceAfter: g.balanceAfter,
  }
}

export default function Records() {
  const [source, setSource] = useState('all')
  const [transactionType, setTransactionType] = useState('all')
  const [gameType, setGameType] = useState('all')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [page, setPage] = useState(1)
  const [merged, setMerged] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const requests = []

      if (source !== 'game') {
        requests.push(
          walletApi
            .getTransactions({
              type: transactionType,
              startDate,
              endDate,
              page: 1,
              pageSize: FETCH_CAP,
            })
            .then((res) => ({ kind: 'transaction', res })),
        )
      }

      if (source !== 'transaction') {
        requests.push(
          gameApi
            .gameHistory({ gameType, page: 1, pageSize: FETCH_CAP })
            .then((res) => ({ kind: 'game', res })),
        )
      }

      const results = await Promise.all(requests)
      const rows = results.flatMap(({ kind, res }) => {
        if (kind === 'transaction') {
          return (res.items || []).filter((row) => !isGameTx(row)).map(txToRow)
        }
        return (res.items || []).map(gameToRow)
      })

      const all = rows
        .filter((row) => rowInDateRange(row, startDate, endDate))
        .sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime())

      setMerged(all)
      setPage(1)
    } catch (err) {
      setError(err?.response?.data?.message || err.message || '讀取紀錄失敗')
      setMerged([])
    } finally {
      setLoading(false)
    }
  }, [endDate, gameType, source, startDate, transactionType])

  useEffect(() => {
    load()
  }, [load])

  const total = merged.length
  const totalPages = Math.max(Math.ceil(total / PAGE_SIZE), 1)
  const pageRows = useMemo(
    () => merged.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [merged, page],
  )

  const updateFilter = (setter) => (value) => {
    setter(value)
    setPage(1)
  }

  return (
    <AppShell>
      <section className="luxury-panel rounded p-4">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
          <div>
            <p className="gold-muted text-xs font-black uppercase tracking-[0.3em]">Records</p>
            <h2 className="brand-title mt-1 text-2xl font-black">交易 / 遊戲紀錄</h2>
            <p className="mt-1 text-sm font-bold text-yellow-100/60">
              可依來源、交易方向、遊戲類型與日期範圍查詢；錢包篩選會送到後端，遊戲日期先在前端整理。
            </p>
          </div>
          <button
            type="button"
            onClick={load}
            className="gold-button rounded px-4 py-2 text-sm font-black transition"
          >
            {loading ? '整理中...' : '重新整理'}
          </button>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <label className="grid gap-1 text-xs font-black uppercase tracking-[0.18em] text-yellow-100/56">
            來源
            <select
              className="min-h-11 rounded border border-yellow-200/15 bg-red-950/70 px-4 text-sm font-bold normal-case tracking-normal text-white outline-none focus:border-yellow-200"
              value={source}
              onChange={(event) => updateFilter(setSource)(event.target.value)}
            >
              {sourceOptions.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>

          <label className="grid gap-1 text-xs font-black uppercase tracking-[0.18em] text-yellow-100/56">
            交易方向
            <select
              className="min-h-11 rounded border border-yellow-200/15 bg-red-950/70 px-4 text-sm font-bold normal-case tracking-normal text-white outline-none focus:border-yellow-200 disabled:opacity-45"
              value={transactionType}
              disabled={source === 'game'}
              onChange={(event) => updateFilter(setTransactionType)(event.target.value)}
            >
              {transactionTypeOptions.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>

          <label className="grid gap-1 text-xs font-black uppercase tracking-[0.18em] text-yellow-100/56">
            遊戲類型
            <select
              className="min-h-11 rounded border border-yellow-200/15 bg-red-950/70 px-4 text-sm font-bold normal-case tracking-normal text-white outline-none focus:border-yellow-200 disabled:opacity-45"
              value={gameType}
              disabled={source === 'transaction'}
              onChange={(event) => updateFilter(setGameType)(event.target.value)}
            >
              {gameTypeOptions.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>

          <label className="grid gap-1 text-xs font-black uppercase tracking-[0.18em] text-yellow-100/56">
            開始日期
            <input
              type="date"
              className="min-h-11 rounded border border-yellow-200/15 bg-red-950/70 px-4 text-sm font-bold normal-case tracking-normal text-white outline-none focus:border-yellow-200"
              value={startDate}
              max={endDate || undefined}
              onChange={(event) => updateFilter(setStartDate)(event.target.value)}
            />
          </label>

          <label className="grid gap-1 text-xs font-black uppercase tracking-[0.18em] text-yellow-100/56">
            結束日期
            <input
              type="date"
              className="min-h-11 rounded border border-yellow-200/15 bg-red-950/70 px-4 text-sm font-bold normal-case tracking-normal text-white outline-none focus:border-yellow-200"
              value={endDate}
              min={startDate || undefined}
              onChange={(event) => updateFilter(setEndDate)(event.target.value)}
            />
          </label>
        </div>
        {error && (
          <p className="mt-3 rounded border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm font-bold text-red-200">
            {error}
          </p>
        )}

        <div className="mt-5 grid gap-3 lg:hidden">
          {pageRows.map((row) => (
            <article key={row.key} className="rounded border border-yellow-200/15 bg-red-950/70 p-4 text-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="gold-muted text-xs font-black uppercase tracking-[0.2em]">類型</p>
                  <p className="mt-1 break-all font-black text-yellow-100">{row.typeLabel}</p>
                </div>
                <span className="shrink-0 rounded border border-yellow-200/15 px-2 py-1 text-xs font-black text-yellow-100/72">
                  {row.sourceLabel}
                </span>
              </div>
              <dl className="mt-4 grid gap-2">
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-yellow-100/62">金額</dt>
                  <dd className={['font-black', (row.amount ?? 0) >= 0 ? 'text-emerald-300' : 'text-red-300'].join(' ')}>
                    {formatSigned(row.amount)}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-yellow-100/62">餘額</dt>
                  <dd className="font-bold text-yellow-100/80">{formatBalance(row.balanceAfter)}</dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-yellow-100/62">時間</dt>
                  <dd className="text-right font-bold text-yellow-100/60">{formatTime(row.time)}</dd>
                </div>
              </dl>
            </article>
          ))}
          {pageRows.length === 0 && (
            <p className="rounded border border-yellow-200/15 bg-red-950/70 px-3 py-8 text-center font-bold text-yellow-100/56">
              沒有符合條件的紀錄
            </p>
          )}
        </div>

        <div className="mt-5 hidden overflow-x-auto lg:block">
          <table className="w-full border-separate border-spacing-y-2 text-left text-sm">
            <thead className="gold-muted text-xs uppercase tracking-[0.2em]">
              <tr>
                <th className="px-3 py-2">時間</th>
                <th className="px-3 py-2">來源</th>
                <th className="px-3 py-2">類型</th>
                <th className="px-3 py-2">金額</th>
                <th className="px-3 py-2">餘額</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((row) => (
                <tr key={row.key} className="bg-red-950/70">
                  <td className="rounded-l border-y border-l border-yellow-200/15 px-3 py-4 text-yellow-100/60 tabular-nums">
                    {formatTime(row.time)}
                  </td>
                  <td className="border-y border-yellow-200/15 px-3 py-4 text-yellow-100/72">{row.sourceLabel}</td>
                  <td className="border-y border-yellow-200/15 px-3 py-4 font-black text-yellow-100">{row.typeLabel}</td>
                  <td className={['border-y border-yellow-200/15 px-3 py-4 font-black tabular-nums', (row.amount ?? 0) >= 0 ? 'text-emerald-300' : 'text-red-300'].join(' ')}>
                    {formatSigned(row.amount)}
                  </td>
                  <td className="rounded-r border-y border-r border-yellow-200/15 px-3 py-4 text-yellow-100/80 tabular-nums">
                    {formatBalance(row.balanceAfter)}
                  </td>
                </tr>
              ))}
              {pageRows.length === 0 && (
                <tr className="bg-red-950/70">
                  <td colSpan="5" className="rounded border border-yellow-200/15 px-3 py-8 text-center font-bold text-yellow-100/56">
                    沒有符合條件的紀錄
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
