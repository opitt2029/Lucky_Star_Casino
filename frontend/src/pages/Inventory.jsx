import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import AppShell from '../components/AppShell'
import DecorativeAsset from '../components/DecorativeAsset'
import { shopApi } from '../services/shopApi'
import { shopCatalog } from '../theme/backgroundTheme'

// itemCode → 商品設定（拿圖片資產 assetKey；兌換紀錄只存 itemCode/title）。
// backgroundTheme.shopCatalog 的 id 即後端 item_code（vip-ticket 等），用作圖片對照。
const catalogByCode = Object.fromEntries(shopCatalog.map((item) => [item.id, item]))

function formatDateTime(value) {
  if (!value) return '-'
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleString()
}

export default function Inventory() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError('')
    shopApi
      .getInventory()
      .then((list) => {
        if (alive) setItems(Array.isArray(list) ? list : [])
      })
      .catch((err) => {
        if (alive) setError(err?.message || '背包讀取失敗')
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [])

  // 同款禮品聚合：顯示數量與最近一次兌換時間（多筆兌換不洗版）。
  const grouped = useMemo(() => {
    const map = new Map()
    for (const it of items) {
      const prev = map.get(it.itemCode)
      if (prev) {
        prev.count += 1
        if (it.redeemedAt > prev.redeemedAt) prev.redeemedAt = it.redeemedAt
      } else {
        map.set(it.itemCode, { ...it, count: 1 })
      }
    }
    return Array.from(map.values())
  }, [items])

  return (
    <AppShell>
      <section className="luxury-panel grid gap-3 rounded p-6 sm:p-8">
        <p className="gold-muted text-xs font-black uppercase tracking-[0.35em]">My Inventory</p>
        <h2 className="brand-title text-4xl font-black tracking-tight sm:text-5xl">我的背包</h2>
        <p className="max-w-2xl text-base font-bold leading-8 text-yellow-100/70">
          這裡收藏你在禮品商城兌換到的物品。
        </p>
        <Link to="/shop" className="gold-button mt-2 inline-flex w-fit rounded px-5 py-3 text-sm font-black transition">
          前往禮品商城
        </Link>
      </section>

      {loading ? (
        <p className="mt-6 rounded border border-yellow-200/15 bg-red-950/60 px-4 py-6 text-center text-sm font-bold text-yellow-100/74">
          背包載入中…
        </p>
      ) : error ? (
        <p className="mt-6 rounded border border-red-400/30 bg-red-950/70 px-4 py-6 text-center text-sm font-bold text-red-200">
          {error}
        </p>
      ) : grouped.length === 0 ? (
        <p className="mt-6 rounded border border-dashed border-yellow-200/24 bg-red-950/50 px-4 py-10 text-center text-base font-black text-yellow-100/62">
          尚未兌換任何禮品，快到禮品商城逛逛吧！
        </p>
      ) : (
        <section className="mt-6 grid gap-4 md:grid-cols-3">
          {grouped.map((item) => {
            const meta = catalogByCode[item.itemCode]
            return (
              <article key={item.itemCode} className="luxury-panel-soft grid gap-4 rounded p-4">
                <DecorativeAsset assetKey={meta?.assetKey || 'shopPrizeA'} className="min-h-48" />
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="gold-muted text-xs font-black uppercase tracking-[0.25em]">Item</p>
                    <h3 className="brand-title mt-2 text-2xl font-black">{item.title}</h3>
                  </div>
                  <span className="gold-text whitespace-nowrap text-lg font-black">x{item.count}</span>
                </div>
                <p className="text-sm font-bold text-yellow-100/64">
                  最近兌換：{formatDateTime(item.redeemedAt)}
                </p>
              </article>
            )
          })}
        </section>
      )}
    </AppShell>
  )
}
