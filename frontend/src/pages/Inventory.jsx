import { useCallback, useEffect, useMemo, useState } from 'react'
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
    caption: meta?.caption || '已兌換的商城道具，可在背包中使用或裝備。',
    cost: meta?.cost ?? item.cost ?? 0,
    assetKey: meta?.assetKey || 'shopPrizeA',
  }
}

function isAvailable(item) {
  return !item.status || item.status === 'COMPLETED'
}

function statusLabel(item) {
  if (item.status === 'USED') return '已使用'
  if (item.status === 'EQUIPPED') return '已裝備'
  return '可使用'
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
  const [usingItem, setUsingItem] = useState(false)
  const [error, setError] = useState('')
  const [pendingUse, setPendingUse] = useState(null)
  const [notice, setNotice] = useState(null)

  const loadInventory = useCallback(() => {
    let alive = true
    setLoading(true)
    setError('')
    shopApi
      .getInventory()
      .then((list) => {
        if (alive) setItems(Array.isArray(list) ? list : [])
      })
      .catch((err) => {
        if (alive) setError(err?.response?.data?.message || err?.message || '背包讀取失敗，請稍後再試。')
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => loadInventory(), [loadInventory])

  const grouped = useMemo(() => {
    const map = new Map()
    for (const item of items) {
      const prev = map.get(item.itemCode)
      if (prev) {
        prev.entries.push(item)
        prev.count += 1
        if (isAvailable(item)) prev.availableCount += 1
        if (item.status === 'USED') prev.usedCount += 1
        if (item.status === 'EQUIPPED') prev.equippedCount += 1
        if (item.redeemedAt > prev.redeemedAt) prev.redeemedAt = item.redeemedAt
      } else {
        map.set(item.itemCode, {
          ...item,
          entries: [item],
          count: 1,
          availableCount: isAvailable(item) ? 1 : 0,
          usedCount: item.status === 'USED' ? 1 : 0,
          equippedCount: item.status === 'EQUIPPED' ? 1 : 0,
        })
      }
    }
    return Array.from(map.values())
  }, [items])

  const pendingMeta = pendingUse ? getItemMeta(pendingUse) : null
  const noticeMeta = notice ? getItemMeta(notice) : null

  const handleUseClick = (group) => {
    const target = group.entries.find(isAvailable)
    if (target) setPendingUse(target)
  }

  const handleConfirmUse = async () => {
    if (!pendingUse) return
    setUsingItem(true)
    setError('')
    try {
      const result = await shopApi.useInventoryItem({ inventoryItemId: pendingUse.id })
      setItems((prev) => prev.map((item) => (
        String(item.id) === String(result.id)
          ? { ...item, ...result, title: item.title, cost: item.cost, redeemedAt: item.redeemedAt }
          : item
      )))
      setNotice({ ...pendingUse, ...result })
      setPendingUse(null)
    } catch (err) {
      setError(err?.response?.data?.message || err?.message || '道具使用失敗，請稍後再試。')
    } finally {
      setUsingItem(false)
    }
  }

  return (
    <AppShell>
      <section className="luxury-panel grid gap-3 rounded p-6 sm:p-8">
        <p className="gold-muted text-xs font-black uppercase tracking-[0.35em]">My Inventory</p>
        <h2 className="brand-title text-4xl font-black tracking-tight sm:text-5xl">我的背包</h2>
        <p className="max-w-2xl text-base font-bold leading-8 text-yellow-100/70">
          商城兌換後的道具會收在這裡。可使用道具會被消耗，外觀類道具會標記為已裝備。
        </p>
        <Link to="/shop" className="gold-button mt-2 inline-flex w-fit rounded px-5 py-3 text-sm font-black transition">
          前往商城
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
          背包目前是空的，去商城兌換第一個道具吧。
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
                <div className="grid gap-1 text-sm font-bold text-yellow-100/64">
                  <span>最近兌換：{formatDateTime(item.redeemedAt)}</span>
                  <span>可使用：{item.availableCount} / 已使用：{item.usedCount} / 已裝備：{item.equippedCount}</span>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span className="gold-muted text-xs font-black uppercase tracking-[0.2em]">
                    {item.availableCount > 0 ? 'Ready' : statusLabel(item.entries[0])}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleUseClick(item)}
                    disabled={item.availableCount <= 0 || usingItem}
                    className="gold-button rounded px-4 py-2 text-xs font-black transition disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    使用道具
                  </button>
                </div>
              </article>
            )
          })}
        </section>
      )}

      {pendingUse && pendingMeta ? (
        <InventoryDialog
          title="確認使用道具"
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
                disabled={usingItem}
                className="gold-button rounded px-4 py-2 text-xs font-black disabled:cursor-not-allowed disabled:opacity-45"
              >
                {usingItem ? '處理中...' : '確認使用'}
              </button>
            </>
          )}
        >
          <p>要使用「{pendingMeta.title}」嗎？</p>
          <p className="mt-2 text-yellow-100/62">確認後會同步後端背包狀態；外觀類道具會標記為已裝備。</p>
        </InventoryDialog>
      ) : null}

      {notice && noticeMeta ? (
        <InventoryDialog
          title={notice.action === 'EQUIPPED' ? '已裝備' : '已使用'}
          labelledBy="inventory-use-done-title"
          actions={(
            <button
              type="button"
              onClick={() => setNotice(null)}
              className="gold-button rounded px-4 py-2 text-xs font-black"
            >
              知道了
            </button>
          )}
        >
          <p>「{noticeMeta.title}」狀態已更新。</p>
          <p className="mt-2 text-yellow-100/62">目前狀態：{notice.status === 'EQUIPPED' ? '已裝備' : '已使用'}</p>
        </InventoryDialog>
      ) : null}
    </AppShell>
  )
}