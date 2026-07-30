import { useCallback, useEffect, useId, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link, useNavigate } from 'react-router-dom'
import { useDispatch, useSelector } from 'react-redux'
import AppShell from '../components/AppShell'
import MetricCard from '../components/MetricCard'
import { walletApi } from '../services/walletApi'
import { extractError } from '../services/memberApi'
import { fetchWallet } from '../store/slices/walletSlice'

const TOPUP_TERMS_DISMISSED_KEY = 'lucky-star-topup-terms-dismissed-v1'

function hasDismissedTopupTerms() {
  if (typeof localStorage === 'undefined') return false
  try {
    return localStorage.getItem(TOPUP_TERMS_DISMISSED_KEY) === '1'
  } catch {
    return false
  }
}

function saveDismissedTopupTerms() {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(TOPUP_TERMS_DISMISSED_KEY, '1')
  } catch {
    // localStorage may be unavailable in private or restricted contexts.
  }
}
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
  const [termsOpen, setTermsOpen] = useState(() => !hasDismissedTopupTerms())
  const [doNotShowTermsAgain, setDoNotShowTermsAgain] = useState(false)
  const termsTitleId = useId()

  const closeTerms = useCallback(() => {
    if (doNotShowTermsAgain) saveDismissedTopupTerms()
    setTermsOpen(false)
  }, [doNotShowTermsAgain])
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

  useEffect(() => {
    if (!termsOpen) return undefined

    const previousOverflow = document.body.style.overflow
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') closeTerms()
    }

    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', handleKeyDown)

    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [closeTerms, termsOpen])
  const selectedPkg = packages.find((pkg) => pkg.packageId === selected)
  const totalLoaded = useMemo(
    () =>
      orders
        .filter((order) => order.status === 'CREDITED')
        .reduce((sum, order) => sum + Number(order.amount || 0), 0),
    [orders]
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
      {termsOpen &&
        createPortal(
          <section
            className="fixed inset-0 z-[10000] grid place-items-center overflow-hidden bg-red-950/74 p-4 backdrop-blur-sm sm:p-6"
            role="dialog"
            aria-modal="true"
            aria-labelledby={termsTitleId}
            data-testid="topup-terms-dialog"
            onClick={closeTerms}
          >
            <div className="w-full max-w-2xl">
              <div
                className="luxury-panel max-h-[calc(100dvh-2rem)] w-full overflow-y-auto overscroll-contain rounded p-5 shadow-2xl sm:max-h-[calc(100dvh-3rem)] sm:p-6"
                onClick={(event) => event.stopPropagation()}
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="gold-muted text-xs font-black uppercase tracking-[0.25em]">
                      Top Up Terms
                    </p>
                    <h2 id={termsTitleId} className="brand-title mt-1 text-2xl font-black">
                      自助加值服務條款
                    </h2>
                  </div>
                  <button
                    type="button"
                    onClick={closeTerms}
                    className="red-gold-button rounded px-3 py-2 text-xs font-black"
                    data-testid="topup-terms-close"
                  >
                    關閉
                  </button>
                </div>

                <div className="mt-5 grid gap-3 md:grid-cols-3">
                  {[
                    ['選擇方案', '請確認加值方案、入帳星幣與目前帳號後再建立訂單。'],
                    ['模擬付款', '本站加值流程為模擬付款體驗，不涉及真實金流或現金儲值。'],
                    ['完成入帳', '付款頁確認後，系統會依訂單狀態將星幣入帳至錢包。'],
                  ].map(([title, copy]) => (
                    <div
                      key={title}
                      className="rounded border border-yellow-200/15 bg-red-950/70 p-4"
                    >
                      <p className="gold-muted text-xs font-black uppercase tracking-[0.18em]">
                        Notice
                      </p>
                      <h3 className="mt-2 text-lg font-black text-yellow-100">{title}</h3>
                      <p className="mt-2 text-sm font-bold leading-6 text-yellow-100/68">{copy}</p>
                    </div>
                  ))}
                </div>

                <div className="mt-4 rounded border border-yellow-200/15 bg-red-950/70 p-4">
                  <p className="gold-muted text-xs font-black uppercase tracking-[0.2em]">Terms</p>
                  <h3 className="brand-title mt-2 text-xl font-black">服務條款</h3>
                  <div className="mt-3 grid gap-2 text-sm font-bold leading-6 text-yellow-100/70">
                    <p>
                      星幣為平台模擬幣，僅供 Lucky Star Casino
                      站內娛樂、遊戲下注與商城功能使用，無現金價值。
                    </p>
                    <p>建立訂單前請確認方案內容；訂單完成後的入帳與狀態以系統紀錄為準。</p>
                    <p>
                      若付款流程、訂單狀態或入帳結果異常，請停止重複送出並透過客服入口聯絡處理。
                    </p>
                  </div>
                </div>

                <label className="mt-4 flex cursor-pointer items-center gap-3 rounded border border-yellow-200/15 bg-red-950/70 px-3 py-2 text-sm font-bold text-yellow-100/78">
                  <input
                    type="checkbox"
                    checked={doNotShowTermsAgain}
                    onChange={(event) => setDoNotShowTermsAgain(event.target.checked)}
                    className="h-4 w-4 accent-yellow-300"
                    data-testid="topup-terms-dismiss-checkbox"
                  />
                  <span>我已閱讀，之後不要再出現</span>
                </label>

                <button
                  type="button"
                  onClick={closeTerms}
                  className="gold-button mt-4 w-full rounded px-4 py-3 text-sm font-black transition"
                >
                  我已了解
                </button>
              </div>
            </div>
          </section>,
          document.body
        )}
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
            <div className="topup-hero-card">
              <img
                src="/backgrounds/casino-rewards-showcase.png"
                alt=""
                className="topup-hero-card__image"
                loading="lazy"
              />
              <span className="topup-hero-card__curtain" />
              <img
                src="/icon/lucky_coin.svg"
                alt=""
                className="topup-hero-card__coin topup-hero-card__coin--large"
                loading="lazy"
              />
              <img
                src="/icon/lucky_coin.svg"
                alt=""
                className="topup-hero-card__coin topup-hero-card__coin--small"
                loading="lazy"
              />
              <span className="topup-hero-card__receipt">
                <span>TOP UP</span>
                <strong>Star Coin</strong>
              </span>
              <span className="topup-hero-card__spark" />
            </div>
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
            caption={
              selectedPkg ? `可得 ${selectedPkg.amount.toLocaleString()} 星幣` : '請選擇方案'
            }
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
                  <span className="gold-muted block text-xs font-black uppercase tracking-[0.2em]">
                    {pkg.packageId}
                  </span>
                  <span className="brand-title mt-2 block text-2xl font-black">
                    {pkg.priceLabel}
                  </span>
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
            {submitting
              ? '建立訂單中...'
              : selectedPkg
                ? `前往付款 ${selectedPkg.priceLabel}`
                : '請選擇方案'}
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
                <strong className="text-yellow-100">
                  {selectedPkg ? selectedPkg.amount.toLocaleString() : '-'}
                </strong>
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
                    <td className="py-3 text-right font-black">
                      {Number(order.amount || 0).toLocaleString()}
                    </td>
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
