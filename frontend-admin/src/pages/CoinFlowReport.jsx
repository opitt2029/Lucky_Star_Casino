import { useCallback, useState } from 'react'
import { adminApi } from '../services/adminApi'
import { useFetch } from '../hooks/useFetch'
import { daysAgo, fmtInt, isoDate } from '../utils/format'
import {
  EmptyBlock,
  ErrorBlock,
  LoadingBlock,
  PageHeader,
  StatCard,
  Table,
  Td,
} from '../components/ui'

const DIMENSIONS = [
  { value: 'day', label: '日' },
  { value: 'week', label: '週' },
  { value: 'month', label: '月' },
]

// 星幣流通量報表（T-052）：issued=發放（CREDIT）、consumed=消耗（下注 DEBIT）、net=淨流通。
export default function CoinFlowReport() {
  // form 是編輯中的條件、applied 是「已查詢」的條件——按下查詢才生效（與 Players 的送出制同理）
  const [form, setForm] = useState({
    dimension: 'day',
    from: isoDate(daysAgo(29)),
    to: isoDate(new Date()),
  })
  const [applied, setApplied] = useState(form)

  const fetchReport = useCallback(() => adminApi.getCoinFlowReport(applied), [applied])
  const { data, loading, error, reload } = useFetch(fetchReport)

  function handleSubmit(e) {
    e.preventDefault()
    if (!form.from || !form.to) return // 後端 from/to 必填
    setApplied(form)
  }

  const inputCls =
    'rounded border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none'

  return (
    <div>
      <PageHeader
        title="星幣流通量報表"
        description="依日/週/月維度統計發放、消耗與淨流通（T-052）。"
      />

      <form onSubmit={handleSubmit} className="mb-6 flex flex-wrap items-end gap-3">
        <label className="block text-sm">
          <span className="mb-1 block text-xs text-slate-500">維度</span>
          <select
            value={form.dimension}
            onChange={(e) => setForm({ ...form, dimension: e.target.value })}
            className={inputCls}
          >
            {DIMENSIONS.map((d) => (
              <option key={d.value} value={d.value}>
                {d.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-xs text-slate-500">起日</span>
          <input
            type="date"
            value={form.from}
            max={form.to}
            onChange={(e) => setForm({ ...form, from: e.target.value })}
            className={inputCls}
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-xs text-slate-500">迄日</span>
          <input
            type="date"
            value={form.to}
            min={form.from}
            onChange={(e) => setForm({ ...form, to: e.target.value })}
            className={inputCls}
          />
        </label>
        <button
          type="submit"
          className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
        >
          查詢
        </button>
      </form>

      {loading && <LoadingBlock />}
      {!loading && error && <ErrorBlock message={error} onRetry={reload} />}
      {!loading && !error && data && (
        <>
          <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <StatCard label="總發放" value={fmtInt(data.totalIssued)} tone="green" hint="簽到 / 任務 / 派彩 / GM / 補助" />
            <StatCard label="總消耗" value={fmtInt(data.totalConsumed)} hint="下注等扣款" />
            <StatCard
              label="淨流通"
              value={fmtInt(data.totalNet)}
              tone={data.totalNet >= 0 ? 'green' : 'red'}
              hint="發放 − 消耗"
            />
          </div>

          {data.points.length === 0 ? (
            <EmptyBlock text="此區間沒有流通紀錄" />
          ) : (
            <Table head={['時間桶', '發放', '消耗', '淨流通']}>
              {data.points.map((pt) => (
                <tr key={pt.bucket}>
                  <Td className="font-medium">{pt.bucket}</Td>
                  <Td className="tabular-nums text-emerald-600">{fmtInt(pt.issued)}</Td>
                  <Td className="tabular-nums">{fmtInt(pt.consumed)}</Td>
                  <Td className={`tabular-nums font-medium ${pt.net < 0 ? 'text-red-600' : ''}`}>
                    {fmtInt(pt.net)}
                  </Td>
                </tr>
              ))}
            </Table>
          )}
        </>
      )}
    </div>
  )
}
