// 後台共用的小型展示元件：載入/錯誤/空狀態、表格骨架、狀態徽章、分頁列。
// 只做展示不含資料邏輯，資料抓取統一走 hooks/useFetch。

export function LoadingBlock() {
  return (
    <div className="flex items-center justify-center py-16 text-sm text-slate-400" role="status">
      資料載入中...
    </div>
  )
}

export function ErrorBlock({ message, onRetry }) {
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-center" role="alert">
      <p className="mb-3 text-sm text-red-600">{message}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="rounded bg-red-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-red-500"
        >
          重試
        </button>
      )}
    </div>
  )
}

export function EmptyBlock({ text = '目前沒有資料' }) {
  return (
    <div className="rounded-lg border border-dashed border-slate-300 bg-white py-12 text-center text-sm text-slate-400">
      {text}
    </div>
  )
}

// Spring Data Page 通用表格外框；欄位內容由呼叫端以 <tr>/<Td> 組合
export function Table({ head, children }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <table className="min-w-full divide-y divide-slate-200 text-sm">
        <thead className="bg-slate-50">
          <tr>
            {head.map((h) => (
              <th
                key={h}
                className="whitespace-nowrap px-4 py-3 text-left text-xs font-medium tracking-wide text-slate-500"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">{children}</tbody>
      </table>
    </div>
  )
}

export function Td({ className = '', children, ...rest }) {
  return (
    <td className={`whitespace-nowrap px-4 py-3 text-slate-700 ${className}`} {...rest}>
      {children}
    </td>
  )
}

const BADGE_STYLES = {
  green: 'bg-emerald-50 text-emerald-700',
  red: 'bg-red-50 text-red-600',
  amber: 'bg-amber-50 text-amber-700',
  slate: 'bg-slate-100 text-slate-600',
}

export function Badge({ color = 'slate', children }) {
  return (
    <span
      className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${BADGE_STYLES[color] || BADGE_STYLES.slate}`}
    >
      {children}
    </span>
  )
}

// 分頁列：吃 Spring Data Page 的 number/totalPages/totalElements/first/last
export function Pagination({ page, onPageChange }) {
  if (!page || page.totalPages <= 1) return null
  const btn =
    'rounded border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40'
  return (
    <div className="mt-4 flex items-center justify-between text-xs text-slate-500">
      <span>
        共 {page.totalElements} 筆 · 第 {page.number + 1} / {page.totalPages} 頁
      </span>
      <div className="space-x-2">
        <button type="button" className={btn} disabled={page.first} onClick={() => onPageChange(page.number - 1)}>
          上一頁
        </button>
        <button type="button" className={btn} disabled={page.last} onClick={() => onPageChange(page.number + 1)}>
          下一頁
        </button>
      </div>
    </div>
  )
}

// 頁面標題列（右側可放操作按鈕）
export function PageHeader({ title, description, children }) {
  return (
    <div className="mb-6 flex items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl font-bold">{title}</h1>
        {description && <p className="mt-1 text-sm text-slate-500">{description}</p>}
      </div>
      {children && <div className="shrink-0">{children}</div>}
    </div>
  )
}

// 統計卡片（Dashboard / 報表摘要用）
export function StatCard({ label, value, tone = 'slate', hint }) {
  const toneCls = {
    slate: 'text-slate-900',
    green: 'text-emerald-600',
    red: 'text-red-600',
  }
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`mt-1 text-2xl font-bold tabular-nums ${toneCls[tone] || toneCls.slate}`}>{value}</div>
      {hint && <div className="mt-1 text-xs text-slate-400">{hint}</div>}
    </div>
  )
}
