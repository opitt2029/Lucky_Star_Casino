import PageStub from '../components/PageStub'

export default function ShopItems() {
  return (
    <PageStub
      title="商城目錄"
      description="禮品商城商品的新增/改價/上下架，寫 admin_action_logs 稽核（ADR-006）。改目錄記得同步玩家端 mockApi.SHOP_CATALOG（AGENTS.md 雷區 14/20）。"
      apis={[
        'GET /admin/shop/items?page=&size=（含已下架）',
        'POST /admin/shop/items（item_code 重複 → 409）',
        'PUT /admin/shop/items/{id}（部分更新）',
      ]}
    />
  )
}
