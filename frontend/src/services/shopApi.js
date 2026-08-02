import api from './api'
import { mockApi } from './mockApi'

const useMockApi = import.meta.env.VITE_USE_MOCK_API !== 'false'

export const shopApi = {
  async getCatalog() {
    if (useMockApi) {
      return mockApi.getShopCatalog()
    }
    const res = await api.get('/api/v1/wallet/shop/catalog')
    return res.data.data || []
  },

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

  async getInventory() {
    if (useMockApi) {
      return mockApi.getInventory()
    }
    const res = await api.get('/api/v1/wallet/shop/inventory')
    return res.data.data || []
  },

  async useInventoryItem({ inventoryItemId } = {}) {
    if (useMockApi) {
      return mockApi.useInventoryItem({ inventoryItemId })
    }
    const res = await api.post(`/api/v1/wallet/shop/inventory/${inventoryItemId}/use`)
    return res.data.data
  },
}
