import { useState } from 'react'
import { adminApi, extractError } from '../services/adminApi'
import { fmtInt } from '../utils/format'
import { PageHeader } from '../components/ui'

// GM 發幣（T-055，僅 SUPER_ADMIN；路由層 SuperAdminRoute + 後端 @PreAuthorize 雙守門）。
// 發幣走 wallet.credit.request 指令、由 wallet-service 非同步入帳（ADR-002），
// 所以成功回應是 QUEUED（已排入佇列），不代表已入帳。
export default function GmGrant() {
  const [form, setForm] = useState({ playerId: '', amount: '', reason: '' })
  // 敏感操作採兩段式：填完按「發放」先進確認態，再按「確認發放」才真的送出
  const [confirming, setConfirming] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)

  const playerId = Number(form.playerId)
  const amount = Number(form.amount)
  const valid =
    Number.isInteger(playerId) && playerId > 0 &&
    Number.isInteger(amount) && amount > 0 &&
    form.reason.trim().length > 0

  function handleChange(field, value) {
    setForm({ ...form, [field]: value })
    setConfirming(false) // 條件一改就退出確認態，避免「確認的是舊資料」
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!valid || submitting) return
    if (!confirming) {
      setConfirming(true)
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const res = await adminApi.gmGrant({ playerId, amount, reason: form.reason.trim() })
      setResult(res)
      setForm({ playerId: '', amount: '', reason: '' }) // 清空表單防止誤按重複發放
      setConfirming(false)
    } catch (err) {
      setError(extractError(err))
    } finally {
      setSubmitting(false)
    }
  }

  const inputCls =
    'w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none'

  return (
    <div>
      <PageHeader
        title="GM 發幣"
        description="向指定玩家手動發放星幣，非同步入帳並寫 admin_action_logs 稽核（T-055，僅 SUPER_ADMIN）。"
      />

      <div className="max-w-lg">
        <form onSubmit={handleSubmit} className="rounded-lg border border-slate-200 bg-white p-6">
          <label className="mb-4 block">
            <span className="mb-1 block text-sm font-medium">玩家 ID</span>
            <input
              type="number"
              min="1"
              value={form.playerId}
              onChange={(e) => handleChange('playerId', e.target.value)}
              className={inputCls}
            />
          </label>

          <label className="mb-4 block">
            <span className="mb-1 block text-sm font-medium">金額（星幣）</span>
            <input
              type="number"
              min="1"
              value={form.amount}
              onChange={(e) => handleChange('amount', e.target.value)}
              className={inputCls}
            />
          </label>

          <label className="mb-6 block">
            <span className="mb-1 block text-sm font-medium">發放原因（寫入稽核紀錄）</span>
            <input
              type="text"
              maxLength={255}
              value={form.reason}
              onChange={(e) => handleChange('reason', e.target.value)}
              placeholder="例：活動補償 / 客訴賠付"
              className={inputCls}
            />
          </label>

          {confirming && (
            <div className="mb-4 rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              即將向玩家 <strong>#{playerId}</strong> 發放{' '}
              <strong>{fmtInt(amount)}</strong> 星幣，原因「{form.reason.trim()}」。
              確認無誤請再按一次。
            </div>
          )}

          {error && (
            <p className="mb-4 rounded bg-red-50 px-3 py-2 text-sm text-red-600" role="alert">
              {error}
            </p>
          )}

          <div className="flex gap-2">
            <button
              type="submit"
              disabled={!valid || submitting}
              className={`flex-1 rounded px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50 ${
                confirming ? 'bg-red-600 hover:bg-red-500' : 'bg-slate-900 hover:bg-slate-700'
              }`}
            >
              {submitting ? '送出中...' : confirming ? '確認發放' : '發放'}
            </button>
            {confirming && (
              <button
                type="button"
                onClick={() => setConfirming(false)}
                className="rounded border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50"
              >
                取消
              </button>
            )}
          </div>
        </form>

        {result && (
          <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
            <p className="font-medium">已排入發放佇列（{result.status}）</p>
            <p className="mt-1">
              玩家 #{result.playerId} · {fmtInt(result.amount)} 星幣，將由 wallet-service 非同步入帳。
            </p>
            <p className="mt-1 break-all text-xs text-emerald-600">冪等鍵：{result.idempotencyKey}</p>
          </div>
        )}
      </div>
    </div>
  )
}
