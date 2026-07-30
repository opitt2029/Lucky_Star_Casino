import { useCallback, useEffect, useId, useMemo, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import AppShell from '../components/AppShell'
import MetricCard from '../components/MetricCard'
import { exchangeDiamondToStarCoin, getDiamondBalance, redeemDiamondCard } from '../services/diamondApi'
import { extractError } from '../services/memberApi'
import {
  clearDiamondMessage,
  fetchDiamondBalance,
  setDiamondBalance,
  setDiamondError,
  setDiamondLoading,
  setDiamondSuccessMessage,
  setLastRedeemAmount,
} from '../store/slices/diamondSlice'
import { fetchWallet, setBalance } from '../store/slices/walletSlice'

const EXCHANGE_RATE = 20
const QUICK_AMOUNTS = [10, 50, 100, 500]
const DIAMOND_GUIDE_DISMISSED_KEY = 'lucky-star-diamond-guide-dismissed-v1'

function hasDismissedDiamondGuide() {
  if (typeof localStorage === 'undefined') return false
  try {
    return localStorage.getItem(DIAMOND_GUIDE_DISMISSED_KEY) === '1'
  } catch {
    return false
  }
}

function saveDismissedDiamondGuide() {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(DIAMOND_GUIDE_DISMISSED_KEY, '1')
  } catch {
    // localStorage may be unavailable in private or restricted contexts.
  }
}

export default function Diamond() {
  const dispatch = useDispatch()
  const { diamondBalance, exchangeRate, loading, error, lastRedeemAmount, successMessage } = useSelector(
    (state) => state.diamond,
  )
  const wallet = useSelector((state) => state.wallet)
  const [cardCode, setCardCode] = useState('')
  const [exchangeAmount, setExchangeAmount] = useState('')
  const [redeemLoading, setRedeemLoading] = useState(false)
  const [exchangeLoading, setExchangeLoading] = useState(false)
  const [redeemValidation, setRedeemValidation] = useState('')
  const [exchangeValidation, setExchangeValidation] = useState('')
  const [guideOpen, setGuideOpen] = useState(() => !hasDismissedDiamondGuide())
  const [doNotShowGuideAgain, setDoNotShowGuideAgain] = useState(false)
  const guideTitleId = useId()
  const resolvedExchangeRate = exchangeRate || EXCHANGE_RATE
  const numericExchangeAmount = Number(exchangeAmount)
  const exchangePreview = Number.isInteger(numericExchangeAmount) && numericExchangeAmount > 0
    ? numericExchangeAmount * resolvedExchangeRate
    : 0
  const anySubmitting = loading || redeemLoading || exchangeLoading
  const availableQuickAmounts = useMemo(
    () => QUICK_AMOUNTS.map((amount) => ({ amount, disabled: amount > diamondBalance })),
    [diamondBalance],
  )

  const exchangeError = useMemo(() => {
    if (!exchangeAmount) return ''
    if (!Number.isInteger(numericExchangeAmount) || numericExchangeAmount <= 0) {
      return '兌換數量必須是正整數'
    }
    if (numericExchangeAmount > diamondBalance) {
      return '兌換數量不可超過目前鑽石餘額'
    }
    return ''
  }, [diamondBalance, exchangeAmount, numericExchangeAmount])

  const closeGuide = useCallback(() => {
    if (doNotShowGuideAgain) saveDismissedDiamondGuide()
    setGuideOpen(false)
  }, [doNotShowGuideAgain])

  useEffect(() => {
    dispatch(fetchDiamondBalance())
    dispatch(fetchWallet())
  }, [dispatch])

  useEffect(() => {
    if (!guideOpen) return undefined

    const previousOverflow = document.body.style.overflow
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') closeGuide()
    }

    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', handleKeyDown)

    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [closeGuide, guideOpen])

  const refreshDiamondBalance = async () => {
    const balance = await getDiamondBalance()
    dispatch(setDiamondBalance(balance.balance))
    return balance
  }

  const handleRedeem = async (event) => {
    event.preventDefault()
    const trimmedCode = cardCode.trim()
    dispatch(clearDiamondMessage())
    setRedeemValidation('')

    if (!trimmedCode) {
      setRedeemValidation('請輸入鑽石卡序號')
      return
    }

    setRedeemLoading(true)
    dispatch(setDiamondLoading(true))
    try {
      const result = await redeemDiamondCard(trimmedCode)
      const redeemedDiamonds = result.redeemedDiamonds ?? result.amount ?? 0
      const nextBalance = result.diamondBalance ?? result.balance

      if (typeof nextBalance === 'number') {
        dispatch(setDiamondBalance(nextBalance))
      } else {
        await refreshDiamondBalance()
      }

      dispatch(setLastRedeemAmount(redeemedDiamonds))
      dispatch(setDiamondSuccessMessage(`兌換成功，本次獲得 ${redeemedDiamonds.toLocaleString()} 鑽石`))
      setCardCode('')
    } catch (apiError) {
      dispatch(setDiamondError(extractError(apiError) || '序號兌換失敗，請稍後再試'))
    } finally {
      setRedeemLoading(false)
      dispatch(setDiamondLoading(false))
    }
  }

  const handleExchange = async (event) => {
    event.preventDefault()
    dispatch(clearDiamondMessage())
    setExchangeValidation('')

    if (!Number.isInteger(numericExchangeAmount) || numericExchangeAmount <= 0) {
      setExchangeValidation('兌換數量必須是正整數')
      return
    }

    if (numericExchangeAmount > diamondBalance) {
      setExchangeValidation('兌換數量不可超過目前鑽石餘額')
      return
    }

    setExchangeLoading(true)
    dispatch(setDiamondLoading(true))
    try {
      const result = await exchangeDiamondToStarCoin(numericExchangeAmount)
      const starAmount = result.starAmount ?? numericExchangeAmount * resolvedExchangeRate
      const diamondBalanceAfter = result.diamondBalanceAfter ?? diamondBalance - numericExchangeAmount

      dispatch(setDiamondBalance(diamondBalanceAfter))
      if (typeof result.starBalanceAfter === 'number') {
        dispatch(setBalance({ balance: result.starBalanceAfter, frozenAmount: wallet.frozenAmount }))
      } else {
        dispatch(setBalance({ balance: wallet.balance + starAmount, frozenAmount: wallet.frozenAmount }))
        dispatch(fetchWallet())
      }

      dispatch(setDiamondSuccessMessage(`兌換成功，獲得 ${starAmount.toLocaleString()} 星幣`))
      setExchangeAmount('')
    } catch (apiError) {
      dispatch(setDiamondError(extractError(apiError) || '鑽石兌換星幣失敗，請稍後再試'))
    } finally {
      setExchangeLoading(false)
      dispatch(setDiamondLoading(false))
    }
  }

  return (
    <AppShell>
      {guideOpen && (
        <section
          className="fixed inset-0 z-[1000] grid place-items-center bg-red-950/74 px-4 py-6 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby={guideTitleId}
          data-testid="diamond-guide-dialog"
          onClick={closeGuide}
        >
          <div
            className="luxury-panel max-h-[calc(100vh-3rem)] w-full max-w-2xl overflow-auto rounded p-5 shadow-2xl sm:p-6"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="gold-muted text-xs font-black uppercase tracking-[0.25em]">Diamond Guide</p>
                <h2 id={guideTitleId} className="brand-title mt-1 text-2xl font-black">
                  鑽石錢包使用說明
                </h2>
              </div>
              <button
                type="button"
                onClick={closeGuide}
                className="red-gold-button rounded px-3 py-2 text-xs font-black"
                data-testid="diamond-guide-close"
              >
                關閉
              </button>
            </div>

            <div className="mt-5 grid gap-3 md:grid-cols-3">
              {[
                ['序號兌換', '輸入鑽石卡序號後，成功兌換的鑽石會立即加入錢包餘額。'],
                ['固定匯率', `鑽石可依 1:${resolvedExchangeRate.toLocaleString()} 的匯率兌換為星幣。`],
                ['確認後送出', '兌換前請確認數量與帳號狀態；送出成功後不可取消。'],
              ].map(([title, copy]) => (
                <div key={title} className="rounded border border-yellow-200/15 bg-red-950/70 p-4">
                  <p className="gold-muted text-xs font-black uppercase tracking-[0.18em]">Guide</p>
                  <h3 className="mt-2 text-lg font-black text-yellow-100">{title}</h3>
                  <p className="mt-2 text-sm font-bold leading-6 text-yellow-100/68">{copy}</p>
                </div>
              ))}
            </div>

            <div className="mt-4 rounded border border-yellow-200/15 bg-red-950/70 p-4">
              <p className="gold-muted text-xs font-black uppercase tracking-[0.2em]">Terms</p>
              <h3 className="brand-title mt-2 text-xl font-black">服務條款</h3>
              <div className="mt-3 grid gap-2 text-sm font-bold leading-6 text-yellow-100/70">
                <p>鑽石與星幣皆為平台模擬幣，僅供 Lucky Star Casino 站內娛樂體驗使用，無現金價值。</p>
                <p>序號兌換與鑽石換星幣紀錄以系統交易紀錄為準；若發現異常，請先停止操作並聯絡客服。</p>
                <p>不得使用非本人取得、偽造、外掛或異常來源的序號；平台可依風控規則暫停可疑兌換。</p>
              </div>
            </div>

            <label className="mt-4 flex cursor-pointer items-center gap-3 rounded border border-yellow-200/15 bg-red-950/70 px-3 py-2 text-sm font-bold text-yellow-100/78">
              <input
                type="checkbox"
                checked={doNotShowGuideAgain}
                onChange={(event) => setDoNotShowGuideAgain(event.target.checked)}
                className="h-4 w-4 accent-yellow-300"
                data-testid="diamond-guide-dismiss-checkbox"
              />
              <span>我已閱讀，之後不要再出現</span>
            </label>

            <button
              type="button"
              onClick={closeGuide}
              className="gold-button mt-4 w-full rounded px-4 py-3 text-sm font-black transition"
            >
              我已了解
            </button>
          </div>
        </section>
      )}
      <section className="diamond-hero luxury-panel rounded p-6 sm:p-8">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-center">
          <div>
            <p className="gold-muted text-xs font-black uppercase tracking-[0.35em]">Diamond Wallet</p>
            <h2 className="brand-title mt-3 text-4xl font-black sm:text-5xl">鑽石錢包</h2>
            <p className="mt-4 max-w-2xl text-base font-bold leading-8 text-yellow-100/72">
              兌換鑽石卡、管理鑽石餘額，並依固定匯率換成可遊玩的星幣。
            </p>
          </div>
          <div className="diamond-hero-gem" aria-hidden="true">
            <div className="diamond-hero-gem__showcase">
              <img
                src="/backgrounds/casino-rewards-showcase.png"
                alt=""
                className="diamond-hero-gem__image"
                loading="lazy"
              />
              <img
                src="/icon/lucky_coin.svg"
                alt=""
                className="diamond-hero-gem__coin diamond-hero-gem__coin--back"
                loading="lazy"
              />
              <img
                src="/icon/lucky_coin.svg"
                alt=""
                className="diamond-hero-gem__coin diamond-hero-gem__coin--front"
                loading="lazy"
              />
              <span className="diamond-hero-gem__crystal" />
              <span className="diamond-hero-gem__label">VIP Diamond</span>
              <span className="diamond-hero-gem__shine" />
            </div>
          </div>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-3">
          <MetricCard
            label="目前鑽石"
            value={loading ? '同步中...' : diamondBalance.toLocaleString()}
            caption="可兌換為星幣"
            tone="light"
          />
          <MetricCard
            label="兌換匯率"
            value={`1 : ${resolvedExchangeRate}`}
            caption={`1 鑽石 = ${resolvedExchangeRate.toLocaleString()} 星幣`}
          />
          <MetricCard
            label="目前星幣"
            value={Number(wallet.balance || 0).toLocaleString()}
            caption="錢包即時餘額"
          />
        </div>

        {(successMessage || lastRedeemAmount > 0) && (
          <p className="mt-5 rounded border border-emerald-400/30 bg-emerald-500/10 px-4 py-3 text-sm font-bold text-emerald-200">
            {successMessage || `兌換成功，本次獲得 ${lastRedeemAmount.toLocaleString()} 鑽石`}
          </p>
        )}
        {error && (
          <p className="mt-5 rounded border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm font-bold text-red-200">
            {error}
          </p>
        )}
      </section>

      <section className="mt-6 grid gap-5 lg:grid-cols-[0.9fr_1.1fr]">
        <form onSubmit={handleRedeem} className="diamond-action-panel luxury-panel-soft rounded p-5 sm:p-6">
          <p className="gold-muted text-xs font-black uppercase tracking-[0.28em]">Redeem Card</p>
          <h3 className="brand-title mt-2 text-2xl font-black">序號兌換鑽石</h3>
          <label className="mt-5 grid gap-2 text-sm font-bold text-yellow-100/78">
            鑽石卡序號
            <input
              name="card_code"
              value={cardCode}
              onChange={(event) => {
                setCardCode(event.target.value)
                setRedeemValidation('')
                dispatch(clearDiamondMessage())
              }}
              className="min-h-12 rounded border border-yellow-200/15 bg-red-950/70 px-4 text-white outline-none focus:border-yellow-200"
              placeholder="TEST123456"
              autoComplete="off"
            />
          </label>
          {redeemValidation && (
            <p className="mt-3 rounded border border-red-400/30 bg-red-500/10 px-3 py-2 text-sm font-bold text-red-200">
              {redeemValidation}
            </p>
          )}
          <button
            type="submit"
            disabled={anySubmitting}
            className="gold-button mt-5 w-full rounded px-4 py-3 text-sm font-black transition disabled:cursor-not-allowed disabled:opacity-60"
          >
            {redeemLoading ? '兌換中...' : '兌換鑽石'}
          </button>
        </form>

        <form onSubmit={handleExchange} className="diamond-action-panel luxury-panel-soft rounded p-5 sm:p-6">
          <p className="gold-muted text-xs font-black uppercase tracking-[0.28em]">Exchange</p>
          <h3 className="brand-title mt-2 text-2xl font-black">鑽石兌換星幣</h3>

          <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_1fr]">
            <div className="rounded border border-yellow-200/15 bg-red-950/70 px-4 py-3">
              <p className="gold-muted text-xs font-bold">可用鑽石</p>
              <p className="mt-1 text-2xl font-black text-yellow-100">{diamondBalance.toLocaleString()}</p>
            </div>
            <div className="rounded border border-yellow-200/15 bg-red-950/70 px-4 py-3">
              <p className="gold-muted text-xs font-bold">預計獲得</p>
              <p className="mt-1 text-2xl font-black text-yellow-100">{exchangePreview.toLocaleString()} 星幣</p>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            {availableQuickAmounts.map(({ amount, disabled }) => (
              <button
                key={amount}
                type="button"
                onClick={() => {
                  setExchangeAmount(String(amount))
                  setExchangeValidation('')
                  dispatch(clearDiamondMessage())
                }}
                disabled={disabled || anySubmitting}
                className="diamond-quick-chip rounded-full px-3 py-2 text-xs font-black transition disabled:cursor-not-allowed disabled:opacity-45"
              >
                {amount.toLocaleString()} 鑽石
              </button>
            ))}
          </div>

          <label className="mt-5 grid gap-2 text-sm font-bold text-yellow-100/78">
            兌換鑽石數量
            <input
              type="number"
              min="1"
              step="1"
              value={exchangeAmount}
              onChange={(event) => {
                setExchangeAmount(event.target.value)
                setExchangeValidation('')
                dispatch(clearDiamondMessage())
              }}
              className="min-h-12 rounded border border-yellow-200/15 bg-red-950/70 px-4 text-white outline-none focus:border-yellow-200"
              placeholder="10"
            />
          </label>
          {(exchangeValidation || exchangeError) && (
            <p className="mt-3 rounded border border-red-400/30 bg-red-500/10 px-3 py-2 text-sm font-bold text-red-200">
              {exchangeValidation || exchangeError}
            </p>
          )}
          <button
            type="submit"
            disabled={anySubmitting || Boolean(exchangeError)}
            className="gold-button mt-5 w-full rounded px-4 py-3 text-sm font-black transition disabled:cursor-not-allowed disabled:opacity-60"
          >
            {exchangeLoading ? '兌換中...' : '兌換星幣'}
          </button>
        </form>
      </section>
    </AppShell>
  )
}