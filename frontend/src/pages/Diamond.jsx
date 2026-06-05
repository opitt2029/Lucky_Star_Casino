import { useEffect, useMemo, useState } from 'react'
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
  const resolvedExchangeRate = exchangeRate || EXCHANGE_RATE
  const numericExchangeAmount = Number(exchangeAmount)
  const exchangePreview = Number.isInteger(numericExchangeAmount) && numericExchangeAmount > 0
    ? numericExchangeAmount * resolvedExchangeRate
    : 0
  const anySubmitting = loading || redeemLoading || exchangeLoading

  const exchangeError = useMemo(() => {
    if (!exchangeAmount) return ''
    if (!Number.isInteger(numericExchangeAmount) || numericExchangeAmount <= 0) {
      return '兌換數量必須為正整數'
    }
    if (numericExchangeAmount > diamondBalance) {
      return '兌換數量不可超過目前鑽石餘額'
    }
    return ''
  }, [diamondBalance, exchangeAmount, numericExchangeAmount])

  useEffect(() => {
    dispatch(fetchDiamondBalance())
    dispatch(fetchWallet())
  }, [dispatch])

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
      setRedeemValidation('請輸入序號')
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
      setExchangeValidation('兌換數量必須為正整數')
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
      <section className="grid gap-5 lg:grid-cols-[1fr_0.38fr]">
        <div className="luxury-panel rounded p-6 sm:p-8">
          <p className="gold-muted text-xs font-black uppercase tracking-[0.35em]">Diamond Wallet</p>
          <h2 className="brand-title mt-3 text-4xl font-black tracking-tight sm:text-5xl">
            鑽石錢包
          </h2>
          <p className="mt-4 max-w-2xl text-base font-bold leading-8 text-yellow-100/70">
            輸入序號可取得鑽石，鑽石能依固定比例兌換成星幣，供遊戲下注與禮品兌換使用。
          </p>

          <div className="mt-6 grid gap-4 md:grid-cols-3">
            <MetricCard
              label="目前鑽石"
              value={loading ? '同步中...' : diamondBalance.toLocaleString()}
              caption="可兌換成星幣"
              tone="light"
            />
            <MetricCard
              label="兌換比例"
              value={`1 : ${resolvedExchangeRate}`}
              caption="1 鑽石 = 20 星幣"
            />
            <MetricCard
              label="目前星幣"
              value={wallet.balance.toLocaleString()}
              caption="可用於下注與兌換"
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
        </div>

        <aside className="grid content-start gap-4">
          <div className="luxury-panel-soft rounded p-5">
            <p className="gold-muted text-xs font-black uppercase tracking-[0.28em]">Balance</p>
            <p className="brand-title mt-2 text-4xl font-black">{diamondBalance.toLocaleString()}</p>
            <p className="mt-2 text-sm font-bold text-yellow-100/62">可用鑽石</p>
            <button
              type="button"
              onClick={() => dispatch(fetchDiamondBalance())}
              disabled={loading}
              className="red-gold-button mt-4 w-full rounded px-4 py-3 text-sm font-black disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? '同步中...' : '重新同步'}
            </button>
          </div>
        </aside>
      </section>

      <section className="mt-6 grid gap-5 lg:grid-cols-2">
        <form onSubmit={handleRedeem} className="luxury-panel-soft rounded p-5 sm:p-6">
          <p className="gold-muted text-xs font-black uppercase tracking-[0.28em]">Redeem Card</p>
          <h3 className="brand-title mt-2 text-2xl font-black">序號兌換鑽石</h3>
          <label className="mt-5 grid gap-2 text-sm font-bold text-yellow-100/78">
              序號
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

        <form onSubmit={handleExchange} className="luxury-panel-soft rounded p-5 sm:p-6">
          <p className="gold-muted text-xs font-black uppercase tracking-[0.28em]">Exchange</p>
          <h3 className="brand-title mt-2 text-2xl font-black">鑽石兌換星幣</h3>
          <p className="mt-3 rounded border border-yellow-200/15 bg-red-950/70 px-4 py-3 text-sm font-black text-yellow-100">
            1 鑽石 = {resolvedExchangeRate.toLocaleString()} 星幣
          </p>
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
          <div className="mt-3 rounded border border-yellow-200/15 bg-red-950/70 px-4 py-3">
            <p className="gold-muted text-xs font-bold">預覽可獲得</p>
            <p className="mt-1 text-2xl font-black text-yellow-100">
              {exchangePreview.toLocaleString()} 星幣
            </p>
          </div>
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
