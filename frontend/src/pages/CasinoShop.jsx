import { useEffect, useMemo, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { Link } from 'react-router-dom'
import AppShell from '../components/AppShell'
import DecorativeAsset from '../components/DecorativeAsset'
import MetricCard from '../components/MetricCard'
import { clearRedeemNotice, redeemShopItem } from '../store/slices/walletSlice'
import { shopApi } from '../services/shopApi'

function ShopItem({ item, balance, redeeming, onRedeem }) {
  // 餘額守門（AGENTS 雷區 13）：星幣不足或兌換進行中都禁止點擊。
  const disabled = balance < item.cost || redeeming

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
          {redeeming ? '兌換中…' : '兌換'}
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

  // 目錄改由後端載入（wallet-service shop 模組）；mock 模式回鏡像目錄。
  useEffect(() => {
    let alive = true
    shopApi
      .getCatalog()
      .then((list) => {
        if (alive) setCatalog(Array.isArray(list) ? list : [])
      })
      .catch((err) => {
        if (alive) setCatalogError(err?.message || '商城目錄讀取失敗')
      })
    return () => {
      alive = false
    }
  }, [])

  // 離開頁面時清掉兌換提示，避免下次進來殘留上一次訊息。
  useEffect(() => () => dispatch(clearRedeemNotice()), [dispatch])

  const notice = redeem.error || redeem.message || catalogError

  const handleRedeem = (item) => {
    // 前端先擋：餘額不足或兌換進行中直接 return（按鈕已 disabled，這裡是雙保險）。
    if (balance < item.cost || redeem.loading) return
    dispatch(redeemShopItem(item))
  }

  return (
    <AppShell>
      <section className="grid gap-4 lg:grid-cols-[1fr_0.34fr]">
        <div className="luxury-panel grid gap-6 rounded p-6 sm:p-8">
          <div>
            <p className="gold-muted text-xs font-black uppercase tracking-[0.35em]">Casino Shop</p>
            <h2 className="brand-title mt-3 text-4xl font-black tracking-tight sm:text-5xl">
              禮品商城
            </h2>
            <p className="mt-4 max-w-2xl text-base font-bold leading-8 text-yellow-100/70">
              使用星幣兌換目前提供的禮品；若星幣不足，可先到鑽石錢包用鑽石兌換星幣。
            </p>
            <Link to="/diamond" className="gold-button mt-5 inline-flex rounded px-5 py-3 text-sm font-black transition">
              前往鑽石錢包
            </Link>
          </div>
          <DecorativeAsset assetKey="shopHero" className="min-h-[320px]" />
        </div>

        <aside className="grid content-start gap-4">
          <MetricCard label="可用星幣" value={balance.toLocaleString()} tone="light" />
          <MetricCard
            label="凍結星幣"
            value={frozenAmount.toLocaleString()}
            caption="暫時保留的星幣"
          />
          <MetricCard
            label="商城總值"
            value={totalPrizeCost.toLocaleString()}
            caption={`${catalog.length} 項禮品`}
          />
          {notice && (
            <div className="rounded border border-yellow-200/15 bg-red-950/70 px-4 py-3 text-sm font-bold text-yellow-100/74">
              <p>{notice}</p>
              {redeem.message && !redeem.error && (
                <Link to="/inventory" className="gold-text mt-2 inline-flex font-black underline">
                  前往我的背包查看
                </Link>
              )}
            </div>
          )}
        </aside>
      </section>

      <section className="mt-6 grid gap-4 md:grid-cols-3">
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
    </AppShell>
  )
}
