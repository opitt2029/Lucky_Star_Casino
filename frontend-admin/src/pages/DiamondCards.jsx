import { useCallback, useState } from 'react'
import { useSelector } from 'react-redux'
import { adminApi, extractError } from '../services/adminApi'
import { useFetch } from '../hooks/useFetch'
import { fmtDateTime, fmtInt } from '../utils/format'
import {
  Badge,
  EmptyBlock,
  ErrorBlock,
  LoadingBlock,
  PageHeader,
  Pagination,
  Table,
  Td,
} from '../components/ui'

const STATUS_OPTIONS = [
  { value: 'all', label: '全部' },
  { value: 'unredeemed', label: '未兌換' },
  { value: 'redeemed', label: '已兌換' },
]

// 鑽石點數卡（T-105 生成 / T-106 列表）。
export default function DiamondCards() {
  // 生成等同印出可兌換星幣的價值，後端僅 SUPER_ADMIN 可呼叫（403）；OPERATOR 只能看列表。
  const role = useSelector((state) => state.adminAuth.role)
  const canGenerate = role === 'SUPER_ADMIN'

  // ── 列表 ──
  const [status, setStatus] = useState('all')
  const [page, setPage] = useState(0)
  const fetchCards = useCallback(
    () => adminApi.listDiamondCards({ page, size: 20, status }),
    [page, status]
  )
  const { data, loading, error, reload } = useFetch(fetchCards)

  // ── 生成表單 ──
  const [genForm, setGenForm] = useState({ count: '10', faceValue: '100' })
  const [generating, setGenerating] = useState(false)
  const [genResult, setGenResult] = useState(null)
  const [genError, setGenError] = useState(null)
  const [copied, setCopied] = useState(false)

  const count = Number(genForm.count)
  const faceValue = Number(genForm.faceValue)
  const genValid =
    Number.isInteger(count) && count >= 1 && count <= 1000 &&
    Number.isInteger(faceValue) && faceValue > 0

  async function handleGenerate(e) {
    e.preventDefault()
    if (!genValid || generating) return
    setGenerating(true)
    setGenError(null)
    setCopied(false)
    try {
      const res = await adminApi.generateDiamondCards({ count, faceValue })
      setGenResult(res)
      setPage(0)
      reload() // 生成後刷新列表，讓新卡立刻可見
    } catch (err) {
      setGenError(extractError(err))
    } finally {
      setGenerating(false)
    }
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(genResult.cardCodes.join('\n'))
      setCopied(true)
    } catch {
      // clipboard API 需要安全上下文（https/localhost），失敗就讓使用者自行從 textarea 複製
    }
  }

  const inputCls =
    'rounded border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none'

  return (
    <div>
      <PageHeader title="鑽石點數卡" description="批次生成序號與兌換狀態查詢（T-105/T-106）。" />

      {/* 生成區：僅 SUPER_ADMIN，OPERATOR 顯示唯讀提示（後端一律 403） */}
      {canGenerate ? (
        <form
          onSubmit={handleGenerate}
          className="mb-6 flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white p-4"
        >
          <label className="block text-sm">
            <span className="mb-1 block text-xs text-slate-500">張數（1~1000）</span>
            <input
              type="number"
              min="1"
              max="1000"
              value={genForm.count}
              onChange={(e) => setGenForm({ ...genForm, count: e.target.value })}
              className={`${inputCls} w-32`}
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-xs text-slate-500">面額（鑽石）</span>
            <input
              type="number"
              min="1"
              value={genForm.faceValue}
              onChange={(e) => setGenForm({ ...genForm, faceValue: e.target.value })}
              className={`${inputCls} w-32`}
            />
          </label>
          <button
            type="submit"
            disabled={!genValid || generating}
            className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {generating ? '生成中...' : '生成點數卡'}
          </button>
          {genError && (
            <p className="w-full text-sm text-red-600" role="alert">
              {genError}
            </p>
          )}
        </form>
      ) : (
        <div className="mb-6 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
          生成點數卡僅限 SUPER_ADMIN 操作。
        </div>
      )}

      {/* 生成結果：序號只在這裡完整show一次，供匯出保存 */}
      {genResult && (
        <div className="mb-6 rounded-lg border border-emerald-200 bg-emerald-50 p-4">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-medium text-emerald-800">
              已生成 {genResult.count} 張、面額 {fmtInt(genResult.faceValue)} 的點數卡，請複製保存序號：
            </p>
            <button
              type="button"
              onClick={handleCopy}
              className="rounded border border-emerald-300 bg-white px-3 py-1 text-xs text-emerald-700 hover:bg-emerald-100"
            >
              {copied ? '已複製 ✓' : '複製全部'}
            </button>
          </div>
          <textarea
            readOnly
            rows={Math.min(genResult.cardCodes.length, 8)}
            value={genResult.cardCodes.join('\n')}
            className="w-full rounded border border-emerald-200 bg-white p-2 font-mono text-xs text-slate-700"
          />
        </div>
      )}

      {/* 列表區 */}
      <div className="mb-3 flex items-center gap-2">
        {STATUS_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => {
              setStatus(opt.value)
              setPage(0)
            }}
            className={`rounded-full px-3 py-1 text-xs font-medium ${
              status === opt.value
                ? 'bg-slate-900 text-white'
                : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {loading && <LoadingBlock />}
      {!loading && error && <ErrorBlock message={error} onRetry={reload} />}
      {!loading && !error && data && data.content.length === 0 && <EmptyBlock text="沒有符合條件的點數卡" />}
      {!loading && !error && data && data.content.length > 0 && (
        <>
          <Table head={['卡號', '面額', '狀態', '兌換者', '兌換時間', '生成時間']}>
            {data.content.map((card) => (
              <tr key={card.cardCode}>
                <Td className="font-mono text-xs">{card.cardCode}</Td>
                <Td className="tabular-nums">{fmtInt(card.faceValue)}</Td>
                <Td>
                  {card.redeemed ? <Badge color="slate">已兌換</Badge> : <Badge color="green">未兌換</Badge>}
                </Td>
                <Td>{card.redeemedBy ? `玩家 #${card.redeemedBy}` : '-'}</Td>
                <Td className="text-slate-500">{fmtDateTime(card.redeemedAt)}</Td>
                <Td className="text-slate-500">{fmtDateTime(card.createdAt)}</Td>
              </tr>
            ))}
          </Table>
          <Pagination page={data} onPageChange={setPage} />
        </>
      )}
    </div>
  )
}
