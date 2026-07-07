import { useCallback, useState } from 'react'
import { adminApi } from '../services/adminApi'
import { useFetch } from '../hooks/useFetch'
import { daysAgo, fmtInt, fmtPercent, isoDate } from '../utils/format'
import {
  Badge,
  EmptyBlock,
  ErrorBlock,
  LoadingBlock,
  PageHeader,
  Table,
  Td,
} from '../components/ui'

// game 參數是後端 game_type 的大寫鍵；空字串=不帶=查全部
const GAME_OPTIONS = [
  { value: '', label: '全部遊戲' },
  { value: 'SLOT', label: '老虎機' },
  { value: 'BACCARAT', label: '百家樂' },
  { value: 'FISHING', label: '捕魚機' },
]

// RTP 監控（T-053）：實際 vs 設計 RTP，偏差超過門檻標 ABNORMAL。
// RTP 為「含本金」口徑（win/bet，AGENTS.md 雷區 17）。
export default function RtpReport() {
  const [form, setForm] = useState({
    game: '',
    from: isoDate(daysAgo(6)),
    to: isoDate(new Date()),
  })
  const [applied, setApplied] = useState(form)

  const fetchReport = useCallback(
    () => adminApi.getRtpReport({ ...applied, game: applied.game || undefined }),
    [applied]
  )
  const { data, loading, error, reload } = useFetch(fetchReport)

  function handleSubmit(e) {
    e.preventDefault()
    if (!form.from || !form.to) return
    setApplied(form)
  }

  const inputCls =
    'rounded border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none'

  return (
    <div>
      <PageHeader
        title="RTP 監控"
        description="實際 vs 設計 RTP 比對（含本金口徑），偏差超過門檻標記 ABNORMAL（T-053）。"
      />

      <form onSubmit={handleSubmit} className="mb-6 flex flex-wrap items-end gap-3">
        <label className="block text-sm">
          <span className="mb-1 block text-xs text-slate-500">遊戲</span>
          <select
            value={form.game}
            onChange={(e) => setForm({ ...form, game: e.target.value })}
            className={inputCls}
          >
            {GAME_OPTIONS.map((g) => (
              <option key={g.value} value={g.value}>
                {g.label}
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
          {data.items.length === 0 ? (
            <EmptyBlock text="此區間沒有 RTP 統計（game_rtp_stats 由 game-service 排程寫入）" />
          ) : (
            <Table head={['遊戲', '設計 RTP', '實際 RTP', '偏差', '總下注', '總派彩', '局數', '狀態']}>
              {data.items.map((item) => (
                <tr key={item.gameType} className={item.status === 'ABNORMAL' ? 'bg-red-50/50' : ''}>
                  <Td className="font-medium">{item.gameType}</Td>
                  <Td className="tabular-nums">{fmtPercent(item.designRtp)}</Td>
                  <Td className="tabular-nums font-medium">{fmtPercent(item.actualRtp)}</Td>
                  <Td className={`tabular-nums ${item.status === 'ABNORMAL' ? 'font-medium text-red-600' : ''}`}>
                    {fmtPercent(item.deviation)}
                  </Td>
                  <Td className="tabular-nums">{fmtInt(item.totalBet)}</Td>
                  <Td className="tabular-nums">{fmtInt(item.totalWin)}</Td>
                  <Td className="tabular-nums">{fmtInt(item.roundCount)}</Td>
                  <Td>
                    {item.status === 'ABNORMAL' ? (
                      <Badge color="red">異常</Badge>
                    ) : (
                      <Badge color="green">正常</Badge>
                    )}
                  </Td>
                </tr>
              ))}
            </Table>
          )}
          <p className="mt-3 text-xs text-slate-400">
            偏差門檻：{fmtPercent(data.deviationThreshold)}（實際與設計 RTP 差距超過即標記異常）
          </p>
        </>
      )}
    </div>
  )
}
