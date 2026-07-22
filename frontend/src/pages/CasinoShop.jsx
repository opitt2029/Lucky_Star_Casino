import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useDispatch, useSelector } from 'react-redux'
import { Link } from 'react-router-dom'
import AppShell from '../components/AppShell'
import DecorativeAsset from '../components/DecorativeAsset'
import MetricCard from '../components/MetricCard'
import { clearRedeemNotice, redeemShopItem } from '../store/slices/walletSlice'
import { shopApi } from '../services/shopApi'

function ShopItem({ item, balance, redeeming, onRedeem }) {
  const canAfford = balance >= item.cost
  const disabled = !canAfford || redeeming

  return (
    <article className="luxury-panel-soft grid gap-4 rounded p-4">
      <DecorativeAsset assetKey={item.assetKey} className="min-h-48" />
      <div>
        <p className="gold-muted text-xs font-black uppercase tracking-[0.25em]">Reward</p>
        <h3 className="brand-title mt-2 text-2xl font-black">{item.name}</h3>
        <p className="mt-2 text-sm font-bold leading-6 text-yellow-100/64">{item.caption}</p>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="gold-text text-lg font-black">{item.cost.toLocaleString()} 星幣</p>
        <button
          type="button"
          onClick={() => onRedeem(item)}
          disabled={disabled}
          className="gold-button min-w-24 rounded px-4 py-2 text-sm font-black transition disabled:cursor-not-allowed disabled:opacity-50"
        >
          {redeeming ? '兌換中...' : canAfford ? '兌換' : '星幣不足'}
        </button>
      </div>
    </article>
  )
}

export default function CasinoShop() {
  const dispatch = useDispatch()
  const balance = useSelector((state) => state.wallet.balance)
  const frozenAmount = useSelector((state) => state.wallet.frozenAmount)
  const redeem = useSelector((state) => state.wallet.redeem)
  const [catalog, setCatalog] = useState([])
  const [catalogError, setCatalogError] = useState('')
  const totalPrizeCost = useMemo(
    () => catalog.reduce((sum, item) => sum + item.cost, 0),
    [catalog],
  )
  const affordableCount = useMemo(
    () => catalog.filter((item) => balance >= item.cost).length,
    [balance, catalog],
  )

  useEffect(() => {
    let alive = true
    shopApi
      .getCatalog()
      .then((list) => {
        if (alive) setCatalog(Array.isArray(list) ? list : [])
      })
      .catch((err) => {
        if (alive) setCatalogError(err?.message || '商品目錄暫時讀取失敗，請稍後再試。')
      })
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => () => dispatch(clearRedeemNotice()), [dispatch])

  useEffect(() => {
    if (!redeem.message || redeem.error) return undefined
    const timer = window.setTimeout(() => dispatch(clearRedeemNotice()), 6500)
    return () => window.clearTimeout(timer)
  }, [dispatch, redeem.error, redeem.message])

  const sideNotice = redeem.error || catalogError
  const successNotice = redeem.message && !redeem.error ? redeem.message : ''

  const handleRedeem = (item) => {
    if (balance < item.cost || redeem.loading) return
    dispatch(redeemShopItem(item))
  }

  const successToast = successNotice ? (
    <div className="pointer-events-none fixed bottom-[calc(env(safe-area-inset-bottom)+5.25rem)] left-1/2 z-[80] flex w-[min(92vw,36rem)] -translate-x-1/2 justify-center md:bottom-8">
      <div
        className="pointer-events-auto w-full rounded border border-emerald-300/35 bg-red-950/95 px-5 py-4 text-yellow-100 shadow-2xl shadow-black/40 backdrop-blur"
        role="status"
        aria-live="polite"
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="gold-muted text-xs font-black uppercase tracking-[0.24em]">Redeemed</p>
            <p className="mt-1 text-sm font-black leading-6 text-emerald-100">{successNotice}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link to="/inventory" className="gold-button rounded px-4 py-2 text-xs font-black">
              前往背包
            </Link>
            <button
              type="button"
              onClick={() => dispatch(clearRedeemNotice())}
              className="red-gold-button rounded px-4 py-2 text-xs font-black"
            >
              關閉
            </button>
          </div>
        </div>
      </div>
    </div>
  ) : null

  return (
    <AppShell>
      <section className="grid gap-4 lg:grid-cols-[1fr_0.34fr]">
        <div className="luxury-panel grid gap-6 rounded p-6 sm:p-8">
          <div>
            <p className="gold-muted text-xs font-black uppercase tracking-[0.35em]">Casino Shop</p>
            <h2 className="brand-title mt-3 text-4xl font-black tracking-tight sm:text-5xl">
              星幣禮品商城
            </h2>
            <p className="mt-4 max-w-2xl text-base font-bold leading-8 text-yellow-100/70">
              用星幣兌換活動資格、收藏獎勵與會員中心裝飾。這些商品會放入背包，方便日後展示或活動使用。
            </p>
            <Link to="/diamond" className="gold-button mt-5 inline-flex rounded px-5 py-3 text-sm font-black transition">
              前往鑽石兌換
            </Link>
          </div>
          <DecorativeAsset assetKey="shopHero" className="min-h-[320px]" />
        </div>

        <aside className="grid content-start gap-4">
          <MetricCard label="可用星幣" value={balance.toLocaleString()} tone="light" />
          <MetricCard
            label="凍結星幣"
            value={frozenAmount.toLocaleString()}
            caption="下注或結算中的星幣會暫時凍結"
          />
          <MetricCard
            label="商品總值"
            value={totalPrizeCost.toLocaleString()}
            caption={`${catalog.length} 件獎勵可瀏覽`}
          />
          <MetricCard
            label="目前可兌換"
            value={affordableCount.toLocaleString()}
            caption="依照你的可用星幣計算"
          />
          {sideNotice && (
            <div className="rounded border border-yellow-200/15 bg-red-950/70 px-4 py-3 text-sm font-bold text-yellow-100/74">
              <p>{sideNotice}</p>
            </div>
          )}
        </aside>
      </section>

      <section className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {catalog.map((item) => (
          <ShopItem
            key={item.itemCode}
            item={item}
            balance={balance}
            redeeming={redeem.loading}
            onRedeem={handleRedeem}
          />
        ))}
      </section>

      {successToast ? createPortal(successToast, document.body) : null}
    </AppShell>
  )
}
