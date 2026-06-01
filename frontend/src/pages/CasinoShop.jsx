import { useMemo, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import AppShell from '../components/AppShell'
import DecorativeAsset from '../components/DecorativeAsset'
import MetricCard from '../components/MetricCard'
import { setBalance } from '../store/slices/walletSlice'
import { shopCatalog } from '../theme/backgroundTheme'

function ShopItem({ item, balance, onRedeem }) {
  const disabled = balance < item.cost

  return (
    <article className="luxury-panel-soft grid gap-4 rounded p-4">
      <DecorativeAsset assetKey={item.assetKey} className="min-h-48" />
      <div>
        <p className="gold-muted text-xs font-black uppercase tracking-[0.25em]">Reward</p>
        <h3 className="brand-title mt-2 text-2xl font-black">{item.title}</h3>
        <p className="mt-2 text-sm font-bold leading-6 text-yellow-100/64">{item.caption}</p>
      </div>
      <div className="flex items-center justify-between gap-3">
        <p className="gold-text text-lg font-black">{item.cost.toLocaleString()} 星幣</p>
        <button
          type="button"
          onClick={() => onRedeem(item)}
          disabled={disabled}
          className="gold-button rounded px-4 py-2 text-sm font-black transition disabled:cursor-not-allowed disabled:opacity-50"
        >
          兌換
        </button>
      </div>
    </article>
  )
}

export default function CasinoShop() {
  const dispatch = useDispatch()
  const balance = useSelector((state) => state.wallet.balance)
  const frozenAmount = useSelector((state) => state.wallet.frozenAmount)
  const [notice, setNotice] = useState('')
  const totalPrizeCost = useMemo(() => shopCatalog.reduce((sum, item) => sum + item.cost, 0), [])

  const handleRedeem = (item) => {
    if (balance < item.cost) {
      setNotice('星幣不足，先去遊戲大全累積更多籌碼。')
      return
    }

    dispatch(setBalance({ balance: balance - item.cost, frozenAmount }))
    setNotice(`已兌換 ${item.title}，後續可接出貨或背包 API。`)
  }

  return (
    <AppShell>
      <section className="grid gap-4 lg:grid-cols-[1fr_0.34fr]">
        <div className="luxury-panel grid gap-6 rounded p-6 sm:p-8">
          <div>
            <p className="gold-muted text-xs font-black uppercase tracking-[0.35em]">Casino Shop</p>
            <h2 className="brand-title mt-3 text-4xl font-black tracking-tight sm:text-5xl">
              賭場商城
            </h2>
            <p className="mt-4 max-w-2xl text-base font-bold leading-8 text-yellow-100/70">
              使用遊戲中贏得的星幣兌換禮品。禮品圖、商城主視覺與每個素材槽都集中在 theme
              檔案中設定。
            </p>
          </div>
          <DecorativeAsset assetKey="shopHero" className="min-h-[320px]" />
        </div>

        <aside className="grid content-start gap-4">
          <MetricCard label="可用星幣" value={balance.toLocaleString()} tone="light" />
          <MetricCard
            label="凍結星幣"
            value={frozenAmount.toLocaleString()}
            caption="保留給未結算流程"
          />
          <MetricCard
            label="商城總值"
            value={totalPrizeCost.toLocaleString()}
            caption={`${shopCatalog.length} 項禮品`}
          />
          {notice && (
            <p className="rounded border border-yellow-200/15 bg-red-950/70 px-4 py-3 text-sm font-bold text-yellow-100/74">
              {notice}
            </p>
          )}
        </aside>
      </section>

      <section className="mt-6 grid gap-4 md:grid-cols-3">
        {shopCatalog.map((item) => (
          <ShopItem key={item.id} item={item} balance={balance} onRedeem={handleRedeem} />
        ))}
      </section>
    </AppShell>
  )
}
