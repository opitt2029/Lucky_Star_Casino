import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import AppShell from '../components/AppShell'
import DecorativeAsset from '../components/DecorativeAsset'
import { shopApi } from '../services/shopApi'
import shopCatalogContract from '../../../contracts/shop-catalog.json'

const catalogByCode = Object.fromEntries(
  shopCatalogContract.items.map((item) => [item.itemCode, item]),
)

function formatDateTime(value) {
  if (!value) return '-'
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleString()
}

function getItemMeta(item) {
  const meta = catalogByCode[item.itemCode]
  return {
    title: meta?.name || item.title || item.itemCode,
    caption: meta?.caption || '這件收藏品已放入你的背包，後續會開放正式使用功能。',
    cost: meta?.cost ?? item.cost ?? 0,
    assetKey: meta?.assetKey || 'shopPrizeA',
  }
}

function InventoryDialog({ title, children, actions, labelledBy }) {
  return createPortal(
    <section
      className="fixed inset-0 z-[90] grid place-items-center bg-red-950/72 px-4 py-6 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelledBy}
    >
      <div className="luxury-panel w-full max-w-md rounded p-5 shadow-2xl">
        <p className="gold-muted text-xs font-black uppercase tracking-[0.25em]">Inventory</p>
        <h3 id={labelledBy} className="brand-title mt-2 text-2xl font-black">
          {title}
        </h3>
        <div className="mt-4 text-sm font-bold leading-6 text-yellow-100/72">{children}</div>
        <div className="mt-5 flex flex-wrap justify-end gap-2">{actions}</div>
      </div>
    </section>,
    document.body,
  )
}

export default function Inventory() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [pendingUse, setPendingUse] = useState(null)
  const [devNotice, setDevNotice] = useState(null)

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
        if (alive) setError(err?.message || '背包暫時讀取失敗，請稍後再試。')
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [])

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

  const pendingMeta = pendingUse ? getItemMeta(pendingUse) : null
  const noticeMeta = devNotice ? getItemMeta(devNotice) : null

  const handleUseClick = (item) => {
    setPendingUse(item)
  }

  const handleConfirmUse = () => {
    if (!pendingUse) return
    setDevNotice(pendingUse)
    setPendingUse(null)
  }

  return (
    <AppShell>
      <section className="luxury-panel grid gap-3 rounded p-6 sm:p-8">
        <p className="gold-muted text-xs font-black uppercase tracking-[0.35em]">My Inventory</p>
        <h2 className="brand-title text-4xl font-black tracking-tight sm:text-5xl">我的背包</h2>
        <p className="max-w-2xl text-base font-bold leading-8 text-yellow-100/70">
          你兌換的收藏品會保存在這裡。按下「使用兌換券」後會先確認，確認後會提示目前功能狀態。
        </p>
        <Link to="/shop" className="gold-button mt-2 inline-flex w-fit rounded px-5 py-3 text-sm font-black transition">
          回到禮品商城
        </Link>
      </section>

      {loading ? (
        <p className="mt-6 rounded border border-yellow-200/15 bg-red-950/60 px-4 py-6 text-center text-sm font-bold text-yellow-100/74">
          背包讀取中...
        </p>
      ) : error ? (
        <p className="mt-6 rounded border border-red-400/30 bg-red-950/70 px-4 py-6 text-center text-sm font-bold text-red-200">
          {error}
        </p>
      ) : grouped.length === 0 ? (
        <p className="mt-6 rounded border border-dashed border-yellow-200/24 bg-red-950/50 px-4 py-10 text-center text-base font-black text-yellow-100/62">
          目前背包還沒有商品。先到商城兌換一件獎勵，就能在這裡查看兌換券。
        </p>
      ) : (
        <section className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {grouped.map((item) => {
            const meta = getItemMeta(item)
            return (
              <article key={item.itemCode} className="luxury-panel-soft grid gap-4 rounded p-4">
                <DecorativeAsset assetKey={meta.assetKey} className="min-h-48" />
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="gold-muted text-xs font-black uppercase tracking-[0.25em]">Item</p>
                    <h3 className="brand-title mt-2 text-2xl font-black">{meta.title}</h3>
                  </div>
                  <span className="gold-text whitespace-nowrap text-lg font-black">x{item.count}</span>
                </div>
                <p className="text-sm font-bold leading-6 text-yellow-100/64">{meta.caption}</p>
                <p className="text-sm font-bold text-yellow-100/64">
                  最近兌換：{formatDateTime(item.redeemedAt)}
                </p>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span className="gold-muted text-xs font-black uppercase tracking-[0.2em]">
                    兌換券
                  </span>
                  <button
                    type="button"
                    onClick={() => handleUseClick(item)}
                    className="gold-button rounded px-4 py-2 text-xs font-black transition"
                  >
                    使用兌換券
                  </button>
                </div>
              </article>
            )
          })}
        </section>
      )}

      {pendingUse && pendingMeta ? (
        <InventoryDialog
          title="確定要使用嗎？"
          labelledBy="inventory-use-confirm-title"
          actions={(
            <>
              <button
                type="button"
                onClick={() => setPendingUse(null)}
                className="red-gold-button rounded px-4 py-2 text-xs font-black"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleConfirmUse}
                className="gold-button rounded px-4 py-2 text-xs font-black"
              >
                確認使用
              </button>
            </>
          )}
        >
          <p>你即將使用「{pendingMeta.title}」。</p>
          <p className="mt-2 text-yellow-100/62">目前不會扣除背包數量，確認後只會顯示功能狀態提示。</p>
        </InventoryDialog>
      ) : null}

      {devNotice && noticeMeta ? (
        <InventoryDialog
          title="功能正在開發"
          labelledBy="inventory-dev-notice-title"
          actions={(
            <button
              type="button"
              onClick={() => setDevNotice(null)}
              className="gold-button rounded px-4 py-2 text-xs font-black"
            >
              我知道了
            </button>
          )}
        >
          <p>「{noticeMeta.title}」的使用功能正在開發中。</p>
          <p className="mt-2 text-yellow-100/62">正式開放後，這張兌換券會套用對應的帳戶或頁面效果。</p>
        </InventoryDialog>
      ) : null}
    </AppShell>
  )
}