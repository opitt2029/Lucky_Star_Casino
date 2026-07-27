import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useDispatch, useSelector } from 'react-redux'
import AppShell from '../components/AppShell'
import MetricCard from '../components/MetricCard'
import { walletApi } from '../services/walletApi'
import { extractError } from '../services/memberApi'
import { fetchWallet } from '../store/slices/walletSlice'

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

function priceNumber(priceLabel = '') {
  return Number(String(priceLabel).replace(/[^0-9]/g, '')) || 0
}

function bonusAmount(pkg) {
  const base = priceNumber(pkg.priceLabel) * 1000
  return Math.max(Number(pkg.amount || 0) - base, 0)
}

export default function Topup() {
  const dispatch = useDispatch()
  const navigate = useNavigate()
  const wallet = useSelector((state) => state.wallet)

  const [packages, setPackages] = useState([])
  const [orders, setOrders] = useState([])
  const [selected, setSelected] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const loadOrders = useCallback(async () => {
    try {
      const list = await walletApi.getTopupOrders()
      setOrders(Array.isArray(list) ? list : [])
    } catch (apiError) {
      setError(extractError(apiError) || '訂單紀錄讀取失敗')
    }
  }, [])

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
  }, [dispatch, loadOrders])

  const selectedPkg = packages.find((pkg) => pkg.packageId === selected)
  const totalLoaded = useMemo(
    () => orders.filter((order) => order.status === 'CREDITED').reduce((sum, order) => sum + Number(order.amount || 0), 0),
    [orders],
  )

  const handleCreateOrder = async () => {
    if (!selected || submitting) return
    setError('')
    setSubmitting(true)
    try {
      const order = await walletApi.createTopupOrder(selected)
      await loadOrders()
      navigate(`/topup/pay/${order.id}`, { state: { order, package: selectedPkg } })
    } catch (apiError) {
      setError(extractError(apiError) || '建立加值訂單失敗，請稍後再試')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AppShell>
      <section className="topup-hero luxury-panel rounded p-6 sm:p-8">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px] lg:items-center">
          <div>
            <p className="gold-muted text-xs font-black uppercase tracking-[0.35em]">Top Up</p>
            <h2 className="brand-title mt-3 text-4xl font-black sm:text-5xl">自助加值</h2>
            <p className="mt-4 max-w-2xl text-base font-bold leading-8 text-yellow-100/72">
              選擇星幣方案後建立訂單，再前往付款頁完成模擬付款與入帳。
            </p>
          </div>
          <div className="topup-hero-art" aria-hidden="true">
            <span className="topup-coin topup-coin--one" />
            <span className="topup-coin topup-coin--two" />
            <span className="topup-receipt" />
          </div>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-3">
          <MetricCard
            label="目前星幣"
            value={wallet.loading ? '同步中...' : Number(wallet.balance || 0).toLocaleString()}
            caption="可用於下注與商城兌換"
            tone="light"
          />
          <MetricCard
            label="已完成加值"
            value={totalLoaded.toLocaleString()}
            caption="本機紀錄與後端訂單列表同步"
          />
          <MetricCard
            label="目前方案"
            value={selectedPkg ? selectedPkg.priceLabel : '-'}
            caption={selectedPkg ? `可得 ${selectedPkg.amount.toLocaleString()} 星幣` : '請選擇方案'}
          />
        </div>
      </section>

      <section className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="luxury-panel-soft rounded p-5 sm:p-6">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="gold-muted text-xs font-black uppercase tracking-[0.28em]">Packages</p>
              <h3 className="brand-title mt-2 text-2xl font-black">選擇充值選項</h3>
            </div>
            <button
              type="button"
              onClick={() => dispatch(fetchWallet())}
              disabled={wallet.loading}
              className="red-gold-button rounded px-4 py-2 text-xs font-black transition disabled:cursor-not-allowed disabled:opacity-60"
            >
              {wallet.loading ? '同步中...' : '同步錢包'}
            </button>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {packages.map((pkg) => {
              const active = pkg.packageId === selected
              const bonus = bonusAmount(pkg)
              return (
                <button
                  key={pkg.packageId}
                  type="button"
                  onClick={() => setSelected(pkg.packageId)}
                  className={`topup-package-card rounded border p-4 text-left transition ${
                    active ? 'topup-package-card--active' : ''
                  }`}
                >
                  <span className="topup-package-card__mark" aria-hidden="true">
                    {priceNumber(pkg.priceLabel) >= 1000 ? '星' : '幣'}
                  </span>
                  <span className="gold-muted block text-xs font-black uppercase tracking-[0.2em]">{pkg.packageId}</span>
                  <span className="brand-title mt-2 block text-2xl font-black">{pkg.priceLabel}</span>
                  <span className="mt-2 block text-sm font-bold text-yellow-100/72">
                    {pkg.amount.toLocaleString()} 星幣
                  </span>
                  {bonus > 0 && (
                    <span className="mt-3 inline-flex rounded-full border border-emerald-300/30 bg-emerald-400/10 px-3 py-1 text-xs font-black text-emerald-200">
                      加贈 {bonus.toLocaleString()}
                    </span>
                  )}
                </button>
              )
            })}
          </div>

          {error && (
            <p className="mt-5 rounded border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm font-bold text-red-200">
              {error}
            </p>
          )}

          <button
            type="button"
            onClick={handleCreateOrder}
            disabled={submitting || loading || !selected}
            className="gold-button mt-6 w-full rounded px-4 py-3 text-sm font-black transition disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? '建立訂單中...' : selectedPkg ? `前往付款 ${selectedPkg.priceLabel}` : '請選擇方案'}
          </button>
        </div>

        <aside className="grid content-start gap-4">
          <div className="topup-mini-ledger luxury-panel-soft rounded p-5">
            <p className="gold-muted text-xs font-black uppercase tracking-[0.28em]">Receipt</p>
            <p className="brand-title mt-2 text-3xl font-black">付款頁確認</p>
            <div className="mt-4 grid gap-3 text-sm font-bold text-yellow-100/74">
              <div className="flex justify-between gap-3">
                <span>方案</span>
                <strong className="text-yellow-100">{selectedPkg?.priceLabel ?? '-'}</strong>
              </div>
              <div className="flex justify-between gap-3">
                <span>入帳星幣</span>
                <strong className="text-yellow-100">{selectedPkg ? selectedPkg.amount.toLocaleString() : '-'}</strong>
              </div>
              <div className="flex justify-between gap-3">
                <span>狀態</span>
                <strong className="text-yellow-100">建立後待付款</strong>
              </div>
            </div>
          </div>
        </aside>
      </section>

      <section className="mt-6 luxury-panel-soft rounded p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="brand-title text-2xl font-black">加值訂單紀錄</h3>
          <button
            type="button"
            onClick={loadOrders}
            className="gold-muted text-xs font-black uppercase tracking-[0.2em] hover:text-yellow-100"
          >
            重新整理
          </button>
        </div>

        {orders.length === 0 ? (
          <p className="mt-5 text-sm font-bold text-yellow-100/60">目前沒有加值訂單。</p>
        ) : (
          <div className="mt-5 overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead>
                <tr className="gold-muted text-xs font-black uppercase tracking-[0.2em]">
                  <th className="pb-3">訂單編號</th>
                  <th className="pb-3">金額</th>
                  <th className="pb-3 text-right">星幣</th>
                  <th className="pb-3">狀態</th>
                  <th className="pb-3">建立時間</th>
                  <th className="pb-3 text-right">操作</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((order) => (
                  <tr key={order.id} className="border-t border-yellow-200/10 text-yellow-100/85">
                    <td className="py-3 font-mono text-xs">{order.orderNo}</td>
                    <td className="py-3 font-bold">{order.priceLabel}</td>
                    <td className="py-3 text-right font-black">{Number(order.amount || 0).toLocaleString()}</td>
                    <td className="py-3 font-bold">{STATUS_LABEL[order.status] ?? order.status}</td>
                    <td className="py-3 text-yellow-100/60">{formatTime(order.createdAt)}</td>
                    <td className="py-3 text-right">
                      {order.status === 'CREATED' ? (
                        <Link
                          to={`/topup/pay/${order.id}`}
                          state={{ order }}
                          className="gold-button inline-flex rounded px-3 py-2 text-xs font-black"
                        >
                          去付款
                        </Link>
                      ) : (
                        <span className="text-yellow-100/45">-</span>
                      )}
                    </td>
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