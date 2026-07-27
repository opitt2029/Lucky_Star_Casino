import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { useDispatch, useSelector } from 'react-redux'
import AppShell from '../components/AppShell'
import MetricCard from '../components/MetricCard'
import { walletApi } from '../services/walletApi'
import { extractError } from '../services/memberApi'
import { fetchWallet, setBalance } from '../store/slices/walletSlice'

const PAYMENT_METHODS = [
  { id: 'card', label: '信用卡', caption: 'VISA / MasterCard' },
  { id: 'atm', label: 'ATM 轉帳', caption: '虛擬帳號付款' },
  { id: 'wallet', label: '電子錢包', caption: '行動支付模擬' },
]

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

export default function TopupPayment() {
  const { orderId } = useParams()
  const location = useLocation()
  const navigate = useNavigate()
  const dispatch = useDispatch()
  const wallet = useSelector((state) => state.wallet)

  const [order, setOrder] = useState(() => location.state?.order ?? null)
  const [method, setMethod] = useState(PAYMENT_METHODS[0].id)
  const [loading, setLoading] = useState(false)
  const [paying, setPaying] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const currentMethod = PAYMENT_METHODS.find((item) => item.id === method)
  const payable = order?.status === 'CREATED'
  const serviceFee = useMemo(() => Math.floor(Number(order?.amount || 0) * 0), [order?.amount])

  const loadOrder = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const orders = await walletApi.getTopupOrders()
      const found = (orders || []).find((item) => String(item.id) === String(orderId))
      if (found) {
        setOrder(found)
      } else if (!order) {
        setError('找不到這筆加值訂單')
      }
    } catch (apiError) {
      setError(extractError(apiError) || '訂單讀取失敗')
    } finally {
      setLoading(false)
    }
  }, [order, orderId])

  useEffect(() => {
    dispatch(fetchWallet())
    if (!order || String(order.id) !== String(orderId)) {
      loadOrder()
    }
  }, [dispatch, loadOrder, order, orderId])

  const handlePay = async () => {
    if (!order || paying || !payable) return
    setPaying(true)
    setError('')
    setSuccess('')
    try {
      const paid = await walletApi.payTopupOrder(order.id)
      setOrder(paid)
      if (typeof paid.balanceAfter === 'number') {
        dispatch(setBalance({ balance: paid.balanceAfter, frozenAmount: wallet.frozenAmount }))
      }
      dispatch(fetchWallet())
      setSuccess(`付款完成，${Number(paid.amount || order.amount || 0).toLocaleString()} 星幣已入帳`)
    } catch (apiError) {
      setError(extractError(apiError) || '付款失敗，請稍後再試')
    } finally {
      setPaying(false)
    }
  }

  return (
    <AppShell>
      <section className="topup-payment luxury-panel rounded p-6 sm:p-8">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-center">
          <div>
            <p className="gold-muted text-xs font-black uppercase tracking-[0.35em]">Payment</p>
            <h2 className="brand-title mt-3 text-4xl font-black sm:text-5xl">加值付款</h2>
            <p className="mt-4 max-w-2xl text-base font-bold leading-8 text-yellow-100/72">
              確認訂單內容與付款方式後，完成模擬付款並將星幣入帳。
            </p>
          </div>
          <div className="topup-payment-card" aria-hidden="true">
            <span className="topup-payment-card__chip" />
            <span className="topup-payment-card__line" />
            <span className="topup-payment-card__line topup-payment-card__line--short" />
          </div>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-3">
          <MetricCard label="付款金額" value={order?.priceLabel ?? '-'} caption="模擬付款，不接真實金流" tone="light" />
          <MetricCard
            label="入帳星幣"
            value={order ? Number(order.amount || 0).toLocaleString() : '-'}
            caption="付款完成後立即同步錢包"
          />
          <MetricCard
            label="訂單狀態"
            value={loading ? '讀取中...' : STATUS_LABEL[order?.status] ?? order?.status ?? '-'}
            caption={order?.orderNo ?? '尚未取得訂單'}
          />
        </div>
      </section>

      <section className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="luxury-panel-soft rounded p-5 sm:p-6">
          <p className="gold-muted text-xs font-black uppercase tracking-[0.28em]">Method</p>
          <h3 className="brand-title mt-2 text-2xl font-black">選擇付款方式</h3>

          <div className="mt-5 grid gap-3 md:grid-cols-3">
            {PAYMENT_METHODS.map((item) => {
              const active = item.id === method
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setMethod(item.id)}
                  className={`topup-method rounded border p-4 text-left transition ${active ? 'topup-method--active' : ''}`}
                >
                  <span className="topup-method__icon" aria-hidden="true" />
                  <span className="mt-3 block text-base font-black text-yellow-100">{item.label}</span>
                  <span className="mt-1 block text-sm font-bold text-yellow-100/58">{item.caption}</span>
                </button>
              )
            })}
          </div>

          <div className="mt-5 rounded border border-yellow-200/15 bg-red-950/55 p-4">
            <p className="gold-muted text-xs font-black uppercase tracking-[0.2em]">Confirm</p>
            <div className="mt-3 grid gap-3 text-sm font-bold text-yellow-100/76">
              <div className="flex justify-between gap-3">
                <span>付款方式</span>
                <strong className="text-yellow-100">{currentMethod?.label}</strong>
              </div>
              <div className="flex justify-between gap-3">
                <span>服務費</span>
                <strong className="text-yellow-100">{serviceFee.toLocaleString()}</strong>
              </div>
              <div className="flex justify-between gap-3">
                <span>建立時間</span>
                <strong className="text-right text-yellow-100">{formatTime(order?.createdAt)}</strong>
              </div>
            </div>
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

          <div className="mt-6 grid gap-3 sm:grid-cols-[1fr_1.4fr]">
            <button
              type="button"
              onClick={() => navigate('/topup')}
              className="red-gold-button rounded px-4 py-3 text-sm font-black transition"
            >
              返回方案
            </button>
            <button
              type="button"
              onClick={handlePay}
              disabled={loading || paying || !payable}
              className="gold-button rounded px-4 py-3 text-sm font-black transition disabled:cursor-not-allowed disabled:opacity-60"
            >
              {paying ? '付款處理中...' : payable ? '確認付款並入帳' : '此訂單已完成'}
            </button>
          </div>
        </div>

        <aside className="grid content-start gap-4">
          <div className="luxury-panel-soft rounded p-5">
            <p className="gold-muted text-xs font-black uppercase tracking-[0.28em]">Order</p>
            <p className="brand-title mt-2 text-3xl font-black">{order?.priceLabel ?? '-'}</p>
            <dl className="mt-4 grid gap-3 text-sm font-bold text-yellow-100/74">
              <div className="flex justify-between gap-3">
                <dt>訂單編號</dt>
                <dd className="max-w-[11rem] truncate text-right font-mono text-yellow-100">{order?.orderNo ?? '-'}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt>方案代號</dt>
                <dd className="text-yellow-100">{order?.packageId ?? '-'}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt>錢包餘額</dt>
                <dd className="text-yellow-100">{Number(wallet.balance || 0).toLocaleString()}</dd>
              </div>
            </dl>
            {order?.status === 'CREDITED' && (
              <Link to="/records" className="gold-button mt-5 inline-flex w-full justify-center rounded px-4 py-3 text-sm font-black">
                查看交易紀錄
              </Link>
            )}
          </div>
        </aside>
      </section>
    </AppShell>
  )
}