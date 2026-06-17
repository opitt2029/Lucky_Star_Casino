import api from './api'
import { mockApi } from './mockApi'

const useMockApi = import.meta.env.VITE_USE_MOCK_API !== 'false'

// 封裝對 wallet-service / member-service（透過 Gateway）真實 API 的呼叫
export const walletApi = {
  // GET /api/v1/wallet/balance → 回傳目前餘額
  async getBalance() {
    if (useMockApi) {
      const wallet = await mockApi.getWallet()
      return {
        balance: wallet.balance,
        frozenAmount: wallet.frozenAmount ?? 0,
        availableBalance: wallet.balance - (wallet.frozenAmount ?? 0),
      }
    }

    const res = await api.get('/api/v1/wallet/balance')
    const data = res.data.data
    return {
      balance: data.balance,
      frozenAmount: data.frozenAmount,
      availableBalance: data.availableBalance,
    }
  },

  // POST /api/v1/wallet/daily-checkin（端點實作在 member-service）
  // 注意：簽到回應只含 rewardAmount / consecutiveDays，不含最新餘額，
  // 因此簽到成功後再查一次餘額，組成 walletSlice 期望的 { reward, wallet } 形狀。
  async dailyCheckIn() {
    if (useMockApi) {
      return mockApi.checkIn()
    }

    const res = await api.post('/api/v1/wallet/daily-checkin')
    const data = res.data.data
    const wallet = await walletApi.getBalance()
    return {
      reward: data.rewardAmount,
      consecutiveDays: data.consecutiveDays,
      wallet,
    }
  },

  // POST /api/v1/wallet/bankruptcy-aid → 領取破產補助
  // 回應含發放金額與入帳前後餘額；再查一次餘額組成 walletSlice 期望的 { wallet } 形狀。
  async claimBankruptcyAid() {
    if (useMockApi) {
      return mockApi.claimBankruptcyAid()
    }

    const res = await api.post('/api/v1/wallet/bankruptcy-aid')
    const data = res.data.data
    const wallet = await walletApi.getBalance()
    return {
      amount: data.amount,
      balanceBefore: data.balanceBefore,
      balanceAfter: data.balanceAfter,
      wallet,
    }
  },

  // ── 自助加值（模擬支付，無真實金流）──────────────────────────────
  // 方案列表寫死於後端；mock 模式下提供等價的固定方案。
  TOPUP_PACKAGES: [
    { packageId: 'P100', priceLabel: 'NT$100', amount: 100000 },
    { packageId: 'P500', priceLabel: 'NT$500', amount: 600000 },
    { packageId: 'P1000', priceLabel: 'NT$1000', amount: 1300000 },
  ],

  // GET /api/v1/wallet/topup/packages
  async getTopupPackages() {
    if (useMockApi) {
      return walletApi.TOPUP_PACKAGES
    }
    const res = await api.get('/api/v1/wallet/topup/packages')
    return res.data.data
  },

  // POST /api/v1/wallet/topup/orders → 建立訂單（status=CREATED）
  async createTopupOrder(packageId) {
    if (useMockApi) {
      const pkg = walletApi.TOPUP_PACKAGES.find((p) => p.packageId === packageId)
      return {
        id: Date.now(),
        orderNo: `MOCK-${Date.now()}`,
        packageId,
        amount: pkg?.amount ?? 0,
        priceLabel: pkg?.priceLabel ?? '',
        status: 'CREATED',
      }
    }
    const res = await api.post('/api/v1/wallet/topup/orders', { packageId })
    return res.data.data
  },

  // POST /api/v1/wallet/topup/orders/{id}/pay → 模擬付款並真實入帳
  async payTopupOrder(orderId) {
    if (useMockApi) {
      const wallet = await mockApi.getWallet()
      return { id: orderId, status: 'CREDITED', balanceAfter: wallet.balance }
    }
    const res = await api.post(`/api/v1/wallet/topup/orders/${orderId}/pay`)
    return res.data.data
  },

  // GET /api/v1/wallet/topup/orders → 自己的加值訂單（新到舊）
  async getTopupOrders() {
    if (useMockApi) {
      return []
    }
    const res = await api.get('/api/v1/wallet/topup/orders')
    return res.data.data
  },
}
