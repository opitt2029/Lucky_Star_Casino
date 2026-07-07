import { useCallback, useState } from 'react'
import { adminApi, extractError } from '../services/adminApi'
import { useFetch } from '../hooks/useFetch'
import { fmtDateTime, fmtInt } from '../utils/format'
import {
  Badge,
  EmptyBlock,
  ErrorBlock,
  LoadingBlock,
  PageHeader,
  Pagination,
  Table,
  Td,
} from '../components/ui'

const inputCls =
  'w-full rounded border border-slate-300 px-2 py-1.5 text-sm focus:border-slate-500 focus:outline-none'

// 商城目錄後台（ADR-006）：新增/改價/上下架，後端寫 admin_action_logs 稽核。
// ⚠️ 改目錄/數值後，記得同步玩家端 mockApi.SHOP_CATALOG（AGENTS.md 雷區 14/20）。
export default function ShopItems() {
  const [page, setPage] = useState(0)
  const fetchItems = useCallback(() => adminApi.listShopItems({ page, size: 20 }), [page])
  const { data, loading, error, reload } = useFetch(fetchItems)

  // ── 新增表單（收合式）──
  const [showCreate, setShowCreate] = useState(false)
  const emptyCreate = { itemCode: '', name: '', caption: '', costStar: '', assetKey: '', sortOrder: '' }
  const [createForm, setCreateForm] = useState(emptyCreate)
  const [createError, setCreateError] = useState(null)
  const [creating, setCreating] = useState(false)

  const createValid =
    createForm.itemCode.trim() && createForm.name.trim() && Number(createForm.costStar) > 0

  async function handleCreate(e) {
    e.preventDefault()
    if (!createValid || creating) return
    setCreating(true)
    setCreateError(null)
    try {
      await adminApi.createShopItem({
        itemCode: createForm.itemCode.trim(),
        name: createForm.name.trim(),
        caption: createForm.caption.trim() || null,
        costStar: Number(createForm.costStar),
        assetKey: createForm.assetKey.trim() || null,
        sortOrder: createForm.sortOrder === '' ? null : Number(createForm.sortOrder),
        active: true,
      })
      setCreateForm(emptyCreate)
      setShowCreate(false)
      reload()
    } catch (err) {
      // item_code 重複時後端回 409，extractError 會帶出訊息
      setCreateError(extractError(err))
    } finally {
      setCreating(false)
    }
  }

  // ── 列內編輯（一次只編一列；editingId=null 表示沒有在編輯）──
  const [editingId, setEditingId] = useState(null)
  const [editForm, setEditForm] = useState(null)
  const [editError, setEditError] = useState(null)
  const [savingEdit, setSavingEdit] = useState(false)

  function startEdit(item) {
    setEditingId(item.id)
    setEditError(null)
    setEditForm({
      name: item.name,
      caption: item.caption || '',
      costStar: String(item.costStar),
      sortOrder: item.sortOrder === null || item.sortOrder === undefined ? '' : String(item.sortOrder),
      active: item.active,
    })
  }

  async function handleSaveEdit(id) {
    if (savingEdit) return
    if (!editForm.name.trim() || Number(editForm.costStar) <= 0) {
      setEditError('名稱必填、價格需為正整數')
      return
    }
    setSavingEdit(true)
    setEditError(null)
    try {
      // PUT 是部分更新（null=不變動），但這裡欄位都有值就整組送出
      await adminApi.updateShopItem(id, {
        name: editForm.name.trim(),
        caption: editForm.caption.trim() || null,
        costStar: Number(editForm.costStar),
        sortOrder: editForm.sortOrder === '' ? null : Number(editForm.sortOrder),
        active: editForm.active,
      })
      setEditingId(null)
      reload()
    } catch (err) {
      setEditError(extractError(err))
    } finally {
      setSavingEdit(false)
    }
  }

  return (
    <div>
      <PageHeader title="商城目錄" description="禮品商城商品的新增/改價/上下架（ADR-006）。改動會寫入稽核紀錄。">
        <button
          type="button"
          onClick={() => setShowCreate((v) => !v)}
          className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
        >
          {showCreate ? '收合' : '＋ 新增商品'}
        </button>
      </PageHeader>

      <p className="mb-4 rounded bg-amber-50 px-3 py-2 text-xs text-amber-700">
        提醒：改動目錄後，記得同步玩家端 <code>mockApi.SHOP_CATALOG</code>（AGENTS.md 雷區 14/20），
        否則走 mock 的玩家端會與實際目錄分歧。
      </p>

      {showCreate && (
        <form onSubmit={handleCreate} className="mb-6 rounded-lg border border-slate-200 bg-white p-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            <label className="block text-sm">
              <span className="mb-1 block text-xs text-slate-500">商品代碼（唯一，建立後不可改）</span>
              <input
                type="text"
                maxLength={50}
                value={createForm.itemCode}
                onChange={(e) => setCreateForm({ ...createForm, itemCode: e.target.value })}
                className={inputCls}
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-xs text-slate-500">名稱</span>
              <input
                type="text"
                maxLength={100}
                value={createForm.name}
                onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
                className={inputCls}
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-xs text-slate-500">價格（星幣）</span>
              <input
                type="number"
                min="1"
                value={createForm.costStar}
                onChange={(e) => setCreateForm({ ...createForm, costStar: e.target.value })}
                className={inputCls}
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-xs text-slate-500">說明（選填）</span>
              <input
                type="text"
                maxLength={255}
                value={createForm.caption}
                onChange={(e) => setCreateForm({ ...createForm, caption: e.target.value })}
                className={inputCls}
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-xs text-slate-500">素材鍵 assetKey（選填）</span>
              <input
                type="text"
                maxLength={50}
                value={createForm.assetKey}
                onChange={(e) => setCreateForm({ ...createForm, assetKey: e.target.value })}
                className={inputCls}
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-xs text-slate-500">排序（小→大，選填）</span>
              <input
                type="number"
                value={createForm.sortOrder}
                onChange={(e) => setCreateForm({ ...createForm, sortOrder: e.target.value })}
                className={inputCls}
              />
            </label>
          </div>
          {createError && (
            <p className="mt-3 text-sm text-red-600" role="alert">
              {createError}
            </p>
          )}
          <button
            type="submit"
            disabled={!createValid || creating}
            className="mt-4 rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {creating ? '建立中...' : '建立商品（預設上架）'}
          </button>
        </form>
      )}

      {loading && <LoadingBlock />}
      {!loading && error && <ErrorBlock message={error} onRetry={reload} />}
      {!loading && !error && data && data.content.length === 0 && <EmptyBlock text="目錄是空的，先新增第一個商品吧" />}
      {!loading && !error && data && data.content.length > 0 && (
        <>
          <Table head={['代碼', '名稱', '說明', '價格', '排序', '狀態', '更新時間', '操作']}>
            {data.content.map((item) =>
              editingId === item.id ? (
                <tr key={item.id} className="bg-slate-50">
                  <Td className="font-mono text-xs text-slate-400">{item.itemCode}</Td>
                  <Td>
                    <input
                      type="text"
                      maxLength={100}
                      value={editForm.name}
                      onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                      className={inputCls}
                    />
                  </Td>
                  <Td>
                    <input
                      type="text"
                      maxLength={255}
                      value={editForm.caption}
                      onChange={(e) => setEditForm({ ...editForm, caption: e.target.value })}
                      className={inputCls}
                    />
                  </Td>
                  <Td>
                    <input
                      type="number"
                      min="1"
                      value={editForm.costStar}
                      onChange={(e) => setEditForm({ ...editForm, costStar: e.target.value })}
                      className={`${inputCls} w-24`}
                    />
                  </Td>
                  <Td>
                    <input
                      type="number"
                      value={editForm.sortOrder}
                      onChange={(e) => setEditForm({ ...editForm, sortOrder: e.target.value })}
                      className={`${inputCls} w-20`}
                    />
                  </Td>
                  <Td>
                    <label className="flex items-center gap-1.5 text-xs">
                      <input
                        type="checkbox"
                        checked={editForm.active}
                        onChange={(e) => setEditForm({ ...editForm, active: e.target.checked })}
                      />
                      上架
                    </label>
                  </Td>
                  <Td className="text-slate-400">{fmtDateTime(item.updatedAt)}</Td>
                  <Td>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => handleSaveEdit(item.id)}
                        disabled={savingEdit}
                        className="rounded bg-slate-900 px-3 py-1 text-xs font-medium text-white hover:bg-slate-700 disabled:opacity-50"
                      >
                        {savingEdit ? '儲存中...' : '儲存'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingId(null)}
                        className="rounded border border-slate-300 px-3 py-1 text-xs text-slate-600 hover:bg-white"
                      >
                        取消
                      </button>
                    </div>
                    {editError && (
                      <p className="mt-1 text-xs text-red-600" role="alert">
                        {editError}
                      </p>
                    )}
                  </Td>
                </tr>
              ) : (
                <tr key={item.id} className={item.active ? '' : 'opacity-60'}>
                  <Td className="font-mono text-xs">{item.itemCode}</Td>
                  <Td className="font-medium">{item.name}</Td>
                  <Td className="max-w-56 truncate text-slate-500" title={item.caption}>
                    {item.caption || '-'}
                  </Td>
                  <Td className="tabular-nums">{fmtInt(item.costStar)}</Td>
                  <Td className="tabular-nums text-slate-400">{item.sortOrder ?? '-'}</Td>
                  <Td>{item.active ? <Badge color="green">上架中</Badge> : <Badge color="slate">已下架</Badge>}</Td>
                  <Td className="text-slate-400">{fmtDateTime(item.updatedAt)}</Td>
                  <Td>
                    <button
                      type="button"
                      onClick={() => startEdit(item)}
                      className="rounded border border-slate-300 px-3 py-1 text-xs text-slate-600 hover:bg-slate-50"
                    >
                      編輯
                    </button>
                  </Td>
                </tr>
              )
            )}
          </Table>
          <Pagination page={data} onPageChange={setPage} />
        </>
      )}
    </div>
  )
}
