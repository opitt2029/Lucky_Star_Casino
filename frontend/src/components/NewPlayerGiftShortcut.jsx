import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLocation } from 'react-router-dom'
import { useDispatch, useSelector } from 'react-redux'
import { fetchProfile } from '../store/slices/authSlice'
import { fetchWallet } from '../store/slices/walletSlice'
import { memberApi } from '../services/memberApi'
import './NewPlayerGiftShortcut.css'

const CLAIMED_KEY_PREFIX = 'lucky-star-new-gift-claimed-v1'
const DEFAULT_GIFT_AMOUNT = 1_000_000
const WALLET_SETTLE_DELAYS_MS = [300, 500, 800, 1200, 1600, 2200]

function claimedKey(playerId) {
  return `${CLAIMED_KEY_PREFIX}:${playerId}`
}

function formatCoins(value) {
  return Number(value || 0).toLocaleString()
}

function GiftPackageIcon({ className = 'h-6 w-6' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true" fill="none">
      <path
        d="M4.75 10.25h14.5v8.5a1.5 1.5 0 0 1-1.5 1.5H6.25a1.5 1.5 0 0 1-1.5-1.5v-8.5Z"
        fill="currentColor"
        opacity="0.96"
      />
      <path d="M3.75 6.75h16.5v4H3.75v-4Z" fill="currentColor" />
      <path d="M12 6.75v13.5M4.75 10.25h14.5" stroke="#4b0508" strokeWidth="1.7" />
      <path
        d="M12 6.5c-1.8-3-5.2-3-5.2-.7 0 1.6 1.8 2.1 5.2 2.1m0-1.4c1.8-3 5.2-3 5.2-.7 0 1.6-1.8 2.1-5.2 2.1"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  )
}

async function waitForWalletCredit(dispatch, targetBalance) {
  let latest = null
  for (const delay of WALLET_SETTLE_DELAYS_MS) {
    try {
      latest = await dispatch(fetchWallet()).unwrap()
      if (!targetBalance || Number(latest.balance || 0) >= targetBalance) return latest
    } catch {
      // Wallet creation and gift credit are both async; retry for a short window.
    }
    await new Promise((resolve) => setTimeout(resolve, delay))
  }
  return latest
}

export default function NewPlayerGiftShortcut() {
  const dispatch = useDispatch()
  const location = useLocation()
  const [open, setOpen] = useState(false)
  const [claiming, setClaiming] = useState(false)
  const [localClaimed, setLocalClaimed] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [lastAmount, setLastAmount] = useState(DEFAULT_GIFT_AMOUNT)

  const isAuthenticated = useSelector((state) => state.auth.isAuthenticated)
  const player = useSelector((state) => state.auth.player)
  const wallet = useSelector((state) => state.wallet)
  const playerId = player?.id
  const isGamePage = location.pathname.startsWith('/game/')

  const serverClaimed = player?.isNewGiftClaimed === true
  const shouldOffer = Boolean(isAuthenticated && playerId && !serverClaimed && !localClaimed)

  useEffect(() => {
    if (!playerId) {
      setLocalClaimed(false)
      setOpen(false)
      return
    }
    setLocalClaimed(localStorage.getItem(claimedKey(playerId)) === '1')
  }, [playerId])

  const shortcutLabel = useMemo(
    () => (isGamePage ? '新手禮' : `新手禮 +${formatCoins(DEFAULT_GIFT_AMOUNT)}`),
    [isGamePage],
  )

  if (!shouldOffer && !open) return null

  const handleClaim = async () => {
    if (!playerId || claiming) return
    setClaiming(true)
    setMessage('')
    setError('')

    const beforeBalance = Number(wallet.balance || 0)
    try {
      const result = await memberApi.claimNewGift()
      const amount = Number(result?.amount || DEFAULT_GIFT_AMOUNT)
      setLastAmount(amount)

      await dispatch(fetchProfile()).unwrap().catch(() => null)
      await waitForWalletCredit(dispatch, result?.alreadyClaimed ? null : beforeBalance + amount)

      localStorage.setItem(claimedKey(playerId), '1')
      setLocalClaimed(true)
      setMessage(result?.alreadyClaimed ? '新手禮已領取，星幣已在你的錢包中。' : '領取成功，星幣已送進錢包。')
    } catch (err) {
      setError(err?.message || '領取失敗，請稍後再試。')
    } finally {
      setClaiming(false)
    }
  }

  const closeDialog = () => {
    setOpen(false)
    setMessage('')
    setError('')
  }

  const content = (
    <>
      {shouldOffer && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={[
            'new-player-gift-shortcut fixed right-0 z-[61] border border-yellow-200/70 bg-red-950 text-yellow-100 shadow-2xl shadow-red-950/60 transition hover:border-yellow-100 hover:bg-red-900 focus:outline-none focus:ring-2 focus:ring-yellow-200/80',
            isGamePage
              ? 'grid h-12 w-12 place-items-center rounded-l text-sm font-black'
              : 'flex items-center gap-2 rounded-l px-3 py-3 text-sm font-black',
          ].join(' ')}
          data-testid="new-player-gift-shortcut"
          aria-label="領取新手禮包"
        >
          <span className="grid h-8 w-8 place-items-center rounded bg-yellow-200 text-red-950 shadow-inner shadow-yellow-500/30">
            <GiftPackageIcon />
          </span>
          {!isGamePage && <span className="whitespace-nowrap">{shortcutLabel}</span>}
        </button>
      )}

      {open && (
        <section
          className="pointer-events-none fixed inset-0 z-50 px-3 py-5 sm:px-5"
          data-testid="new-player-gift-dialog"
          role="dialog"
          aria-modal="false"
          aria-labelledby="new-player-gift-title"
        >
          <div
            className={[
              'luxury-panel pointer-events-auto ml-auto max-h-[calc(100vh-2.5rem)] w-full max-w-sm overflow-auto rounded bg-red-950/98 p-5 shadow-2xl shadow-red-950/70',
              isGamePage ? 'mt-16 sm:mr-2' : 'mt-20 sm:mr-4',
            ].join(' ')}
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-3">
                <span className="grid h-12 w-12 shrink-0 place-items-center rounded border border-yellow-200/70 bg-yellow-200 text-red-950 shadow-lg shadow-yellow-900/30">
                  <GiftPackageIcon className="h-8 w-8" />
                </span>
                <div>
                  <p className="gold-muted text-xs font-black uppercase tracking-[0.22em]">Welcome Gift</p>
                  <h2 id="new-player-gift-title" className="brand-title mt-1 text-2xl font-black">
                    新手禮包
                  </h2>
                </div>
              </div>
              <button
                type="button"
                onClick={closeDialog}
                className="red-gold-button rounded px-3 py-2 text-xs font-black"
              >
                關閉
              </button>
            </div>

            <div className="mt-5 rounded border border-yellow-200/30 bg-red-950 p-4 shadow-inner shadow-black/30">
              <p className="text-sm font-bold leading-6 text-yellow-100/88">
                送你一筆開局星幣，先試試遊戲、商城和錢包功能。領取後這個快速捷徑會自動消失。
              </p>
              <p className="mt-3 text-3xl font-black text-yellow-100">+{formatCoins(lastAmount)}</p>
              <p className="gold-muted mt-1 text-xs font-bold uppercase tracking-[0.18em]">Star Coin</p>
            </div>

            <button
              type="button"
              onClick={handleClaim}
              disabled={claiming || localClaimed || serverClaimed}
              className="gold-button mt-4 w-full rounded px-4 py-3 text-sm font-black transition disabled:cursor-not-allowed disabled:opacity-55"
            >
              {claiming ? '領取中...' : localClaimed || serverClaimed ? '已領取' : '立即領取'}
            </button>

            {message && (
              <p className="mt-3 rounded border border-emerald-400/30 bg-emerald-500/10 px-3 py-2 text-sm font-bold text-emerald-200">
                {message}
              </p>
            )}
            {error && (
              <p className="mt-3 rounded border border-red-400/30 bg-red-500/10 px-3 py-2 text-sm font-bold text-red-200">
                {error}
              </p>
            )}

            <p className="mt-4 text-xs leading-5 text-yellow-100/66">
              禮包只限每個玩家領取一次；入帳可能需要幾秒同步，系統會自動重新整理錢包餘額。
            </p>
          </div>
        </section>
      )}
    </>
  )

  return typeof document === 'undefined' ? content : createPortal(content, document.body)
}
