import { useEffect } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import AppShell from '../components/AppShell'
import { fetchTransactions, setTransactionFilters, setTransactionPage } from '../store/slices/walletSlice'

const typeOptions = [
  ['all', '全部'],
  ['bet', '下注'],
  ['payout', '派彩'],
  ['checkin', '簽到'],
  ['task', '任務'],
  ['gift', '贈送'],
]

export default function Transactions() {
  const dispatch = useDispatch()
  const { transactions, transactionTotal, transactionPage, transactionPageSize, filters, loading, error } = useSelector((state) => state.wallet)
  const totalPages = Math.max(Math.ceil(transactionTotal / transactionPageSize), 1)

  useEffect(() => {
    dispatch(fetchTransactions({ ...filters, page: transactionPage, pageSize: transactionPageSize }))
  }, [dispatch, filters, transactionPage, transactionPageSize])

  return (
    <AppShell>
      <section className="luxury-panel rounded p-4">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
          <div>
            <p className="gold-muted text-xs font-black uppercase tracking-[0.3em]">Wallet Ledger</p>
            <h2 className="brand-title mt-1 text-2xl font-black">交易紀錄</h2>
          </div>
          <button
            type="button"
            onClick={() => dispatch(fetchTransactions({ ...filters, page: transactionPage, pageSize: transactionPageSize }))}
            className="gold-button rounded px-4 py-2 text-sm font-black transition"
          >
            {loading ? '同步中...' : '同步流水'}
          </button>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-[1fr_180px_180px]">
          <select
            className="min-h-11 rounded border border-yellow-200/15 bg-red-950/70 px-4 text-sm font-bold text-white outline-none focus:border-yellow-200"
            value={filters.type}
            onChange={(event) => dispatch(setTransactionFilters({ type: event.target.value }))}
          >
            {typeOptions.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <input
            type="date"
            className="min-h-11 rounded border border-yellow-200/15 bg-red-950/70 px-4 text-sm font-bold text-white outline-none focus:border-yellow-200"
            value={filters.startDate}
            onChange={(event) => dispatch(setTransactionFilters({ startDate: event.target.value }))}
          />
          <input
            type="date"
            className="min-h-11 rounded border border-yellow-200/15 bg-red-950/70 px-4 text-sm font-bold text-white outline-none focus:border-yellow-200"
            value={filters.endDate}
            onChange={(event) => dispatch(setTransactionFilters({ endDate: event.target.value }))}
          />
        </div>
        {error && <p className="mt-3 rounded border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm font-bold text-red-200">{error}</p>}

        <div className="mt-5 overflow-x-auto">
          <table className="w-full min-w-[680px] border-separate border-spacing-y-2 text-left text-sm">
            <thead className="gold-muted text-xs uppercase tracking-[0.2em]">
              <tr>
                <th className="px-3 py-2">交易 ID</th>
                <th className="px-3 py-2">類型</th>
                <th className="px-3 py-2">金額</th>
                <th className="px-3 py-2">狀態</th>
                <th className="px-3 py-2">時間</th>
              </tr>
            </thead>
            <tbody>
              {transactions.map((row) => (
                <tr key={row.id} className="bg-red-950/70">
                  <td className="rounded-l border-y border-l border-yellow-200/15 px-3 py-4 font-black text-yellow-100">{row.id}</td>
                  <td className="border-y border-yellow-200/15 px-3 py-4 text-yellow-100/72">{row.typeLabel}</td>
                  <td className={['border-y border-yellow-200/15 px-3 py-4 font-black', row.amount < 0 ? 'text-red-200' : 'text-yellow-200'].join(' ')}>
                    {row.amount > 0 ? '+' : ''}
                    {row.amount.toLocaleString()}
                  </td>
                  <td className="border-y border-yellow-200/15 px-3 py-4 text-yellow-100/72">{row.status}</td>
                  <td className="rounded-r border-y border-r border-yellow-200/15 px-3 py-4 text-yellow-100/60">{new Date(row.createdAt).toLocaleString()}</td>
                </tr>
              ))}
              {transactions.length === 0 && (
                <tr className="bg-red-950/70">
                  <td colSpan="5" className="rounded border border-yellow-200/15 px-3 py-8 text-center font-bold text-yellow-100/56">
                    沒有符合條件的交易紀錄
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="mt-4 flex items-center justify-between">
          <p className="gold-muted text-sm font-bold">
            第 {transactionPage} / {totalPages} 頁，共 {transactionTotal} 筆
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => dispatch(setTransactionPage(Math.max(transactionPage - 1, 1)))}
              disabled={transactionPage <= 1}
              className="red-gold-button rounded px-4 py-2 text-sm font-black disabled:cursor-not-allowed disabled:opacity-40"
            >
              上一頁
            </button>
            <button
              type="button"
              onClick={() => dispatch(setTransactionPage(Math.min(transactionPage + 1, totalPages)))}
              disabled={transactionPage >= totalPages}
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
