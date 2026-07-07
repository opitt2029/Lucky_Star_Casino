import { useCallback, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { adminApi, extractError } from '../services/adminApi'
import { useFetch } from '../hooks/useFetch'
import { fmtDateTime, fmtInt } from '../utils/format'
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

// 玩家詳情（T-051/T-108）：跨庫彙整 member/wallet/game 資料 + 停用/啟用開關。
export default function PlayerDetail() {
  const { playerId } = useParams()

  const fetchDetail = useCallback(() => adminApi.getPlayer(playerId), [playerId])
  const { data, loading, error, reload } = useFetch(fetchDetail)

  // 停用/啟用是兩段式確認（先按一次進入確認態，再按一次才送出）：
  // 不用 window.confirm 是因為原生對話框會阻塞整個瀏覽器事件圈、樣式也無法控制。
  const [confirming, setConfirming] = useState(false)
  const [saving, setSaving] = useState(false)
  const [actionError, setActionError] = useState(null)

  async function handleToggleStatus() {
    if (!confirming) {
      setConfirming(true)
      return
    }
    setSaving(true)
    setActionError(null)
    try {
      // 目前停用中 → 這次是「啟用」（enabled: true），反之亦然
      await adminApi.setPlayerStatus(playerId, data.disabled)
      setConfirming(false)
      await reload() // 以後端回寫後的狀態為準，不在前端自行翻轉
    } catch (err) {
      setActionError(extractError(err))
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <LoadingBlock />
  if (error) {
    return (
      <div>
        <ErrorBlock message={error} onRetry={reload} />
        <Link to="/players" className="mt-4 inline-block text-sm text-slate-500 hover:text-slate-700">
          ← 回玩家列表
        </Link>
      </div>
    )
  }
  if (!data) return null

  const toggleLabel = data.disabled ? '啟用帳號' : '停用帳號'

  return (
    <div>
      <Link to="/players" className="mb-4 inline-block text-sm text-slate-500 hover:text-slate-700">
        ← 回玩家列表
      </Link>

      <PageHeader
        title={
          <>
            {data.username}
            <span className="ml-3 align-middle">
              {data.disabled ? <Badge color="red">已停用</Badge> : <Badge color="green">正常</Badge>}
            </span>
          </>
        }
        description={`玩家 #${data.playerId} · ${data.nickname || '（無暱稱）'} · 註冊於 ${fmtDateTime(data.createdAt)}`}
      >
        <div className="text-right">
          {confirming && !saving && (
            <span className="mr-2 text-xs text-slate-500">
              確定要{toggleLabel}？
              <button
                type="button"
                onClick={() => setConfirming(false)}
                className="ml-1 underline hover:text-slate-700"
              >
                取消
              </button>
            </span>
          )}
          <button
            type="button"
            onClick={handleToggleStatus}
            disabled={saving}
            className={`rounded px-4 py-2 text-sm font-medium text-white disabled:opacity-50 ${
              data.disabled
                ? 'bg-emerald-600 hover:bg-emerald-500'
                : confirming
                  ? 'bg-red-600 hover:bg-red-500'
                  : 'bg-slate-900 hover:bg-slate-700'
            }`}
          >
            {saving ? '處理中...' : confirming ? `確認${toggleLabel}` : toggleLabel}
          </button>
          {!data.disabled && (
            <p className="mt-1 text-xs text-slate-400">停用會寫入 Redis 封鎖，gateway 即時生效</p>
          )}
          {actionError && (
            <p className="mt-1 text-xs text-red-600" role="alert">
              {actionError}
            </p>
          )}
        </div>
      </PageHeader>

      {/* 基本資料 + 錢包 */}
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="星幣餘額" value={fmtInt(data.balance)} />
        <StatCard label="凍結金額" value={fmtInt(data.frozenAmount)} tone={data.frozenAmount > 0 ? 'red' : 'slate'} />
        <StatCard label="Email" value={<span className="text-base">{data.email || '-'}</span>} />
        <StatCard label="角色" value={<span className="text-base">{data.role}</span>} />
      </div>

      {/* 近期帳務流水 */}
      <h2 className="mb-3 text-lg font-semibold">近期帳務</h2>
      {data.recentTransactions.length === 0 ? (
        <EmptyBlock text="沒有帳務紀錄" />
      ) : (
        <Table head={['ID', '類型', '子型', '金額', '餘額', '關聯單號', '時間']}>
          {data.recentTransactions.map((t) => (
            <tr key={t.id}>
              <Td className="tabular-nums text-slate-400">{t.id}</Td>
              <Td>
                <Badge color={t.type === 'CREDIT' ? 'green' : 'amber'}>{t.type}</Badge>
              </Td>
              <Td>{t.subType}</Td>
              <Td className={`tabular-nums font-medium ${t.type === 'CREDIT' ? 'text-emerald-600' : 'text-slate-700'}`}>
                {t.type === 'CREDIT' ? '+' : '-'}
                {fmtInt(t.amount)}
              </Td>
              <Td className="tabular-nums">{fmtInt(t.balanceAfter)}</Td>
              <Td className="max-w-48 truncate text-slate-400" title={t.referenceId}>
                {t.referenceId || '-'}
              </Td>
              <Td className="text-slate-500">{fmtDateTime(t.createdAt)}</Td>
            </tr>
          ))}
        </Table>
      )}

      {/* 近期對局 */}
      <h2 className="mb-3 mt-8 text-lg font-semibold">近期對局</h2>
      {data.recentRounds.length === 0 ? (
        <EmptyBlock text="沒有對局紀錄" />
      ) : (
        <Table head={['局號', '遊戲', '下注', '派彩', '狀態', '時間']}>
          {data.recentRounds.map((r) => (
            <tr key={r.roundId}>
              <Td className="max-w-56 truncate text-slate-400" title={r.roundId}>
                {r.roundId}
              </Td>
              <Td>{r.gameType}</Td>
              <Td className="tabular-nums">{fmtInt(r.betAmount)}</Td>
              {/* winAmount 是「含本金」派彩（AGENTS.md 雷區 17 口徑），> 下注即該局為玩家淨贏 */}
              <Td className={`tabular-nums ${r.winAmount > r.betAmount ? 'font-medium text-emerald-600' : ''}`}>
                {fmtInt(r.winAmount)}
              </Td>
              <Td>
                <Badge color={r.status === 'SETTLED' ? 'slate' : 'amber'}>{r.status}</Badge>
              </Td>
              <Td className="text-slate-500">{fmtDateTime(r.createdAt)}</Td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  )
}
