import { useCallback, useEffect, useMemo, useState } from 'react'
import AppShell from '../components/AppShell'
import { walletApi } from '../services/walletApi'
import { gameApi } from '../services/gameApi'

const PAGE_SIZE = 10
// 從兩個來源各抓最近這麼多筆再合併排序：避免把整段歷史全載入前端（bounded fetch）。
// 兩個服務各自分頁，無法用「各取第 N 頁再合併」正確地跨頁排序，故改抓一段夠用的視窗。
const FETCH_CAP = 200

const sourceOptions = [
  ['all', '全部'],
  ['transaction', '交易'],
  ['game', '遊戲'],
]

const gameTypeLabels = {
  SLOT: '老虎機',
  BACCARAT: '百家樂',
  FISHING: '捕魚機',
}

// 遊戲相關的交易子型：這些已由「遊戲」那一列涵蓋，合併時濾掉，避免同一經濟事件重複出現。
// mock 用小寫 bet/payout；真實後端 subType 用大寫 BET/WIN（見 walletApi.toTransactionRow）。
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

// 把交易列、遊戲列正規化成同一種「合併列」形狀（時間 / 來源 / 類型 / 金額 / 餘額）。
function txToRow(tx) {
  return {
    key: `tx-${tx.id}`,
    time: tx.createdAt,
    source: 'transaction',
    sourceLabel: '交易',
    typeLabel: tx.typeLabel,
    amount: tx.amount, // 已是帶正負號（DEBIT 為負）
    balanceAfter: null, // 帳務流水不含當下餘額，故合併表交易列的餘額顯示為 '-'
  }
}

function gameToRow(g) {
  return {
    key: `game-${g.roundId}`,
    time: g.settledAt || g.betAt,
    source: 'game',
    sourceLabel: '遊戲',
    typeLabel: gameTypeLabels[g.gameType] || g.gameType,
    amount: g.profit, // 損益（派彩 − 投注）
    balanceAfter: g.balanceAfter,
  }
}

export default function Records() {
  const [source, setSource] = useState('all')
  const [page, setPage] = useState(1)
  const [merged, setMerged] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      // 兩個服務併發抓取，彼此獨立、無先後依賴。
      const [txRes, gameRes] = await Promise.all([
        walletApi.getTransactions({ type: 'all', page: 1, pageSize: FETCH_CAP }),
        gameApi.gameHistory({ gameType: 'all', page: 1, pageSize: FETCH_CAP }),
      ])
      const txRows = (txRes.items || []).filter((row) => !isGameTx(row)).map(txToRow)
      const gameRows = (gameRes.items || []).map(gameToRow)
      const all = [...txRows, ...gameRows].sort(
        (a, b) => new Date(b.time).getTime() - new Date(a.time).getTime(),
      )
      setMerged(all)
      setPage(1)
    } catch (err) {
      setError(err?.response?.data?.message || err.message || '讀取紀錄失敗')
      setMerged([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  // 來源篩選在前端做（資料已合併在記憶體，不必再打後端）。
  const filtered = useMemo(
    () => (source === 'all' ? merged : merged.filter((row) => row.source === source)),
    [merged, source],
  )
  const total = filtered.length
  const totalPages = Math.max(Math.ceil(total / PAGE_SIZE), 1)
  const pageRows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const handleSourceChange = (value) => {
    setSource(value)
    setPage(1)
  }

  return (
    <AppShell>
      <section className="luxury-panel rounded p-4">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
          <div>
            <p className="gold-muted text-xs font-black uppercase tracking-[0.3em]">Records</p>
            <h2 className="brand-title mt-1 text-2xl font-black">交易/遊戲紀錄</h2>
            <p className="mt-1 text-sm font-bold text-yellow-100/60">
              交易與遊戲統整為同一條時間軸；每次遊戲以損益列出一筆，下注/派彩流水不重複顯示。
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
            value={source}
            onChange={(event) => handleSourceChange(event.target.value)}
          >
            {sourceOptions.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        {error && <p className="mt-3 rounded border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm font-bold text-red-200">{error}</p>}

        {/* 手機版：卡片列表 */}
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

        {/* 桌機版：表格 */}
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
