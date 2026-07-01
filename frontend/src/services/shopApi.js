import api from './api'
import { mockApi } from './mockApi'

const useMockApi = import.meta.env.VITE_USE_MOCK_API !== 'false'

// 禮品商城 API 封裝（後端 wallet-service shop 模組，端點掛在 /api/v1/wallet/shop/**，ADR-006）。
// 真實後端回傳 ApiResponse 形狀 { data: ... }；mock 路徑沿用既有 mockApi。
// 兩條路徑統一正規化回相同形狀，呼叫端（walletSlice / 頁面）不需分支。
export const shopApi = {
  // 目錄：上架商品 → [{ itemCode, name, caption, cost, assetKey }]
  async getCatalog() {
    if (useMockApi) {
      return mockApi.getShopCatalog()
    }
    const res = await api.get('/api/v1/wallet/shop/catalog')
    return res.data.data || []
  },

  // 兌換禮品 → { itemName, balanceAfter }
  async redeemItem({ itemCode, idempotencyKey } = {}) {
    if (useMockApi) {
      const result = await mockApi.redeemShopItem({ itemCode })
      return { itemName: result.item.title, balanceAfter: result.wallet.balance }
    }
    const body = {
      itemCode,
      idempotencyKey:
        idempotencyKey || `shop-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    }
    const res = await api.post('/api/v1/wallet/shop/redeem', body)
    const data = res.data.data
    return { itemName: data.itemName, balanceAfter: data.balanceAfter }
  },

  // 背包：兌換到的禮品 → [{ itemCode, title, cost, redeemedAt }]
  async getInventory() {
    if (useMockApi) {
      return mockApi.getInventory()
    }
    const res = await api.get('/api/v1/wallet/shop/inventory')
    return res.data.data || []
  },
}
