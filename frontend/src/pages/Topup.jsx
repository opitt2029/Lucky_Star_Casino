import { useEffect, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import AppShell from '../components/AppShell'
import MetricCard from '../components/MetricCard'
import { walletApi } from '../services/walletApi'
import { extractError } from '../services/memberApi'
import { fetchWallet, setBalance } from '../store/slices/walletSlice'

const STATUS_LABEL = {
  CREATED: '待付款',
  PAID: '付款中',
  CREDITED: '已入帳',
  FAILED: '失敗',
}

function formatTime(value) {
  if (!value) return '-'
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString()
}

export default function Topup() {
  const dispatch = useDispatch()
  const wallet = useSelector((state) => state.wallet)

  const [packages, setPackages] = useState([])
  const [orders, setOrders] = useState([])
  const [selected, setSelected] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const loadOrders = async () => {
    try {
      const list = await walletApi.getTopupOrders()
      setOrders(Array.isArray(list) ? list : [])
    } catch (apiError) {
      setError(extractError(apiError) || '訂單記錄讀取失敗')
    }
  }

  useEffect(() => {
    let active = true
    setLoading(true)
    dispatch(fetchWallet())
    ;(async () => {
      try {
        const pkgs = await walletApi.getTopupPackages()
        if (active) {
          setPackages(pkgs)
          setSelected(pkgs?.[0]?.packageId ?? null)
        }
        await loadOrders()
      } catch (apiError) {
        if (active) setError(extractError(apiError) || '加值方案讀取失敗')
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => {
      active = false
    }
  }, [dispatch])

  const handlePay = async () => {
    if (!selected || submitting) return
    setError('')
    setSuccess('')
    setSubmitting(true)
    try {
      // 建單 → 模擬付款（後端在同一交易內真實入帳星幣）
      const order = await walletApi.createTopupOrder(selected)
      const paid = await walletApi.payTopupOrder(order.id)

      if (typeof paid.balanceAfter === 'number') {
        dispatch(setBalance({ balance: paid.balanceAfter, frozenAmount: wallet.frozenAmount }))
      }
      dispatch(fetchWallet())
      await loadOrders()

      const pkg = packages.find((p) => p.packageId === selected)
      setSuccess(`加值成功，獲得 ${(pkg?.amount ?? 0).toLocaleString()} 星幣`)
    } catch (apiError) {
      setError(extractError(apiError) || '加值失敗，請稍後再試')
    } finally {
      setSubmitting(false)
    }
  }

  const selectedPkg = packages.find((p) => p.packageId === selected)

  return (
    <AppShell>
      <section className="grid gap-5 lg:grid-cols-[1fr_0.38fr]">
        <div className="luxury-panel rounded p-6 sm:p-8">
          <p className="gold-muted text-xs font-black uppercase tracking-[0.35em]">Top Up</p>
          <h2 className="brand-title mt-3 text-4xl font-black tracking-tight sm:text-5xl">
            自助加值
          </h2>
          <p className="mt-4 max-w-2xl text-base font-bold leading-8 text-yellow-100/70">
            選擇加值方案並完成付款（模擬支付，無真實金流），星幣將即時入帳至你的錢包。
          </p>

          <div className="mt-6 grid gap-4 md:grid-cols-2">
            <MetricCard
              label="目前星幣"
              value={wallet.loading ? '同步中...' : wallet.balance.toLocaleString()}
              caption="可用於下注與兌換"
              tone="light"
            />
            <MetricCard
              label="選擇方案"
              value={selectedPkg ? selectedPkg.priceLabel : '-'}
              caption={selectedPkg ? `可獲得 ${selectedPkg.amount.toLocaleString()} 星幣` : '請選擇方案'}
            />
          </div>

          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            {packages.map((pkg) => {
              const active = pkg.packageId === selected
              return (
                <button
                  key={pkg.packageId}
                  type="button"
                  onClick={() => setSelected(pkg.packageId)}
                  className={`rounded border px-4 py-5 text-left transition ${
                    active
                      ? 'border-yellow-200 bg-yellow-200/10'
                      : 'border-yellow-200/15 bg-red-950/70 hover:border-yellow-200/40'
                  }`}
                >
                  <p className="gold-muted text-xs font-black uppercase tracking-[0.2em]">{pkg.packageId}</p>
                  <p className="brand-title mt-2 text-2xl font-black">{pkg.priceLabel}</p>
                  <p className="mt-2 text-sm font-bold text-yellow-100/70">
                    {pkg.amount.toLocaleString()} 星幣
                  </p>
                </button>
              )
            })}
          </div>

          {success && (
            <p className="mt-5 rounded border border-emerald-400/30 bg-emerald-500/10 px-4 py-3 text-sm font-bold text-emerald-200">
              {success}
            </p>
          )}
          {error && (
            <p className="mt-5 rounded border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm font-bold text-red-200">
              {error}
            </p>
          )}

          <button
            type="button"
            onClick={handlePay}
            disabled={submitting || loading || !selected}
            className="gold-button mt-6 w-full rounded px-4 py-3 text-sm font-black transition disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? '付款中...' : selectedPkg ? `確認付款 ${selectedPkg.priceLabel}` : '請選擇方案'}
          </button>
        </div>

        <aside className="grid content-start gap-4">
          <div className="luxury-panel-soft rounded p-5">
            <p className="gold-muted text-xs font-black uppercase tracking-[0.28em]">Balance</p>
            <p className="brand-title mt-2 text-4xl font-black">{wallet.balance.toLocaleString()}</p>
            <p className="mt-2 text-sm font-bold text-yellow-100/62">目前星幣</p>
            <button
              type="button"
              onClick={() => dispatch(fetchWallet())}
              disabled={wallet.loading}
              className="red-gold-button mt-4 w-full rounded px-4 py-3 text-sm font-black disabled:cursor-not-allowed disabled:opacity-60"
            >
              {wallet.loading ? '同步中...' : '重新同步'}
            </button>
          </div>
        </aside>
      </section>

      <section className="mt-6 luxury-panel-soft rounded p-5 sm:p-6">
        <div className="flex items-center justify-between">
          <h3 className="brand-title text-2xl font-black">加值訂單記錄</h3>
          <button
            type="button"
            onClick={loadOrders}
            className="gold-muted text-xs font-black uppercase tracking-[0.2em] hover:text-yellow-100"
          >
            重新整理
          </button>
        </div>

        {orders.length === 0 ? (
          <p className="mt-5 text-sm font-bold text-yellow-100/60">尚無加值記錄。</p>
        ) : (
          <div className="mt-5 overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead>
                <tr className="gold-muted text-xs font-black uppercase tracking-[0.2em]">
                  <th className="pb-3">訂單編號</th>
                  <th className="pb-3">方案</th>
                  <th className="pb-3 text-right">星幣</th>
                  <th className="pb-3">狀態</th>
                  <th className="pb-3">建立時間</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => (
                  <tr key={o.id} className="border-t border-yellow-200/10 text-yellow-100/85">
                    <td className="py-3 font-mono text-xs">{o.orderNo}</td>
                    <td className="py-3 font-bold">{o.priceLabel}</td>
                    <td className="py-3 text-right font-black">{o.amount.toLocaleString()}</td>
                    <td className="py-3 font-bold">{STATUS_LABEL[o.status] ?? o.status}</td>
                    <td className="py-3 text-yellow-100/60">{formatTime(o.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </AppShell>
  )
}
