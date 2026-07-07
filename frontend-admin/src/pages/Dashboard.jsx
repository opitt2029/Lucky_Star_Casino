import { useCallback } from 'react'
import { Link } from 'react-router-dom'
import { adminApi } from '../services/adminApi'
import { useFetch } from '../hooks/useFetch'
import { daysAgo, fmtInt, fmtPercent, isoDate } from '../utils/format'
import {
  Badge,
  EmptyBlock,
  ErrorBlock,
  LoadingBlock,
  PageHeader,
  StatCard,
  Table,
  Td,
} from '../components/ui'

// 總覽：近 7 日流通概況 + 各遊戲 RTP 健康度。
// admin_alerts（T-054）目前只有寫入、還沒有查詢端點，告警區塊待後端補 API 後加上。
export default function Dashboard() {
  const fetchOverview = useCallback(async () => {
    const from = isoDate(daysAgo(6))
    const to = isoDate(new Date())
    // 兩支報表互不相依，平行抓、一起等
    const [coinFlow, rtp] = await Promise.all([
      adminApi.getCoinFlowReport({ dimension: 'day', from, to }),
      adminApi.getRtpReport({ from, to }),
    ])
    return { coinFlow, rtp }
  }, [])
  const { data, loading, error, reload } = useFetch(fetchOverview)

  if (loading) return <LoadingBlock />
  if (error) return <ErrorBlock message={error} onRetry={reload} />
  if (!data) return null

  const { coinFlow, rtp } = data
  const abnormal = rtp.items.filter((item) => item.status === 'ABNORMAL')

  return (
    <div>
      <PageHeader title="總覽" description="近 7 日營運概況（流通量 + RTP 健康度）。" />

      {/* RTP 異常置頂告警：有異常時營運要第一眼看到 */}
      {abnormal.length > 0 && (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4" role="alert">
          <p className="mb-1 text-sm font-medium text-red-700">
            ⚠ {abnormal.length} 個遊戲 RTP 異常（偏差超過 {fmtPercent(rtp.deviationThreshold)}）
          </p>
          <p className="text-sm text-red-600">
            {abnormal.map((item) => `${item.gameType}（實際 ${fmtPercent(item.actualRtp)}）`).join('、')}
            {' — '}
            <Link to="/reports/rtp" className="underline">
              前往 RTP 監控
            </Link>
          </p>
        </div>
      )}

      {/* 近 7 日流通量 */}
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="text-lg font-semibold">星幣流通（近 7 日）</h2>
        <Link to="/reports/coin-flow" className="text-xs text-slate-500 hover:text-slate-700">
          完整報表 →
        </Link>
      </div>
      <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="總發放" value={fmtInt(coinFlow.totalIssued)} tone="green" />
        <StatCard label="總消耗" value={fmtInt(coinFlow.totalConsumed)} />
        <StatCard
          label="淨流通"
          value={fmtInt(coinFlow.totalNet)}
          tone={coinFlow.totalNet >= 0 ? 'green' : 'red'}
          hint="發放 − 消耗"
        />
      </div>

      {/* 各遊戲 RTP 一覽 */}
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="text-lg font-semibold">RTP 健康度（近 7 日）</h2>
        <Link to="/reports/rtp" className="text-xs text-slate-500 hover:text-slate-700">
          完整報表 →
        </Link>
      </div>
      {rtp.items.length === 0 ? (
        <EmptyBlock text="近 7 日沒有 RTP 統計資料" />
      ) : (
        <Table head={['遊戲', '設計 RTP', '實際 RTP', '偏差', '局數', '狀態']}>
          {rtp.items.map((item) => (
            <tr key={item.gameType} className={item.status === 'ABNORMAL' ? 'bg-red-50/50' : ''}>
              <Td className="font-medium">{item.gameType}</Td>
              <Td className="tabular-nums">{fmtPercent(item.designRtp)}</Td>
              <Td className="tabular-nums font-medium">{fmtPercent(item.actualRtp)}</Td>
              <Td className={`tabular-nums ${item.status === 'ABNORMAL' ? 'font-medium text-red-600' : ''}`}>
                {fmtPercent(item.deviation)}
              </Td>
              <Td className="tabular-nums">{fmtInt(item.roundCount)}</Td>
              <Td>
                {item.status === 'ABNORMAL' ? <Badge color="red">異常</Badge> : <Badge color="green">正常</Badge>}
              </Td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  )
}
