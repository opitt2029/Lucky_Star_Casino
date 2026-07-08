import { useCallback, useState } from 'react'
import { Link } from 'react-router-dom'
import { adminApi, extractError } from '../services/adminApi'
import { useFetch } from '../hooks/useFetch'
import { daysAgo, fmtDateTime, fmtInt, fmtPercent, isoDate } from '../utils/format'
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

// T-054 告警類型 → 顯示文字/徽章色
const ALERT_TYPE_LABELS = {
  BIG_WIN: { text: '大額中獎', color: 'amber' },
  HIGH_FREQUENCY: { text: '高頻下注', color: 'red' },
  ABNORMAL_TRANSFER: { text: '帳務異常', color: 'red' },
}

// 總覽：未處理異常告警（T-054）+ 近 7 日流通概況 + 各遊戲 RTP 健康度。
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

  // 告警分頁：未處理 / 已處理。切換時 fetchAlerts 引用改變 → useFetch 自動重抓對應清單。
  const [alertTab, setAlertTab] = useState('unresolved')
  const showResolved = alertTab === 'resolved'
  // 告警獨立抓取：標記已處理後只重載告警區塊，不重抓整頁報表
  const fetchAlerts = useCallback(
    () => adminApi.listAlerts({ size: 10, resolved: showResolved }),
    [showResolved],
  )
  const {
    data: alerts,
    loading: alertsLoading,
    error: alertsError,
    reload: reloadAlerts,
  } = useFetch(fetchAlerts)
  const [resolvingId, setResolvingId] = useState(null)
  const [resolveError, setResolveError] = useState(null)

  async function handleResolve(alertId) {
    setResolvingId(alertId)
    setResolveError(null)
    try {
      await adminApi.resolveAlert(alertId)
      await reloadAlerts()
    } catch (err) {
      setResolveError(extractError(err))
    } finally {
      setResolvingId(null)
    }
  }

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

      {/* 異常告警（T-054）：未處理 / 已處理 分頁，置於報表之前，異常要第一眼看到 */}
      <div className="mb-2 flex items-baseline justify-between">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold">異常告警</h2>
          <div className="flex gap-0.5 rounded-lg bg-slate-100 p-0.5 text-xs">
            {[
              ['unresolved', '未處理'],
              ['resolved', '已處理'],
            ].map(([key, text]) => (
              <button
                key={key}
                type="button"
                onClick={() => setAlertTab(key)}
                className={`rounded-md px-3 py-1 font-medium ${
                  alertTab === key
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                {text}
              </button>
            ))}
          </div>
        </div>
        {alerts && alerts.totalElements > 0 && (
          <span className="text-xs text-slate-500">
            共 {alerts.totalElements} 筆{showResolved ? '已處理' : '未處理'}
          </span>
        )}
      </div>
      {resolveError && (
        <p className="mb-2 text-sm text-red-600" role="alert">
          標記失敗：{resolveError}
        </p>
      )}
      <div className="mb-8">
        {alertsLoading ? (
          <LoadingBlock />
        ) : alertsError ? (
          <ErrorBlock message={alertsError} onRetry={reloadAlerts} />
        ) : !alerts || alerts.content.length === 0 ? (
          <EmptyBlock text={showResolved ? '目前沒有已處理的告警' : '目前沒有未處理的告警'} />
        ) : showResolved ? (
          <Table head={['時間', '玩家 ID', '類型', '詳情', '處理者', '處理時間']}>
            {alerts.content.map((alert) => {
              const label = ALERT_TYPE_LABELS[alert.alertType] || { text: alert.alertType, color: 'slate' }
              return (
                <tr key={alert.id}>
                  <Td className="tabular-nums text-slate-500">{fmtDateTime(alert.createdAt)}</Td>
                  <Td>
                    <Link to={`/players/${alert.playerId}`} className="font-medium text-blue-600 hover:underline">
                      {alert.playerId}
                    </Link>
                  </Td>
                  <Td>
                    <Badge color={label.color}>{label.text}</Badge>
                  </Td>
                  <Td className="max-w-md truncate text-slate-500" title={alert.detail}>
                    {alert.detail}
                  </Td>
                  <Td className="font-medium">{alert.resolvedBy || '-'}</Td>
                  <Td className="tabular-nums text-slate-500">{fmtDateTime(alert.resolvedAt)}</Td>
                </tr>
              )
            })}
          </Table>
        ) : (
          <Table head={['時間', '玩家 ID', '類型', '詳情', '操作']}>
            {alerts.content.map((alert) => {
              const label = ALERT_TYPE_LABELS[alert.alertType] || { text: alert.alertType, color: 'slate' }
              return (
                <tr key={alert.id}>
                  <Td className="tabular-nums text-slate-500">{fmtDateTime(alert.createdAt)}</Td>
                  <Td>
                    <Link to={`/players/${alert.playerId}`} className="font-medium text-blue-600 hover:underline">
                      {alert.playerId}
                    </Link>
                  </Td>
                  <Td>
                    <Badge color={label.color}>{label.text}</Badge>
                  </Td>
                  <Td className="max-w-md truncate text-slate-500" title={alert.detail}>
                    {alert.detail}
                  </Td>
                  <Td>
                    <button
                      type="button"
                      disabled={resolvingId === alert.id}
                      onClick={() => handleResolve(alert.id)}
                      className="rounded border border-slate-300 bg-white px-3 py-1 text-xs text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {resolvingId === alert.id ? '處理中...' : '標記已處理'}
                    </button>
                  </Td>
                </tr>
              )
            })}
          </Table>
        )}
      </div>

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
                {item.status === 'ABNORMAL' ? <Badge color="red">異常</Badge> : item.status === 'NO_DATA' ? <Badge color="slate">無資料</Badge> : <Badge color="green">正常</Badge>}
              </Td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  )
}
