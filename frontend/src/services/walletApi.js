import api from './api'
import { mockApi } from './mockApi'

const useMockApi = import.meta.env.VITE_USE_MOCK_API !== 'false'

// 後端 wallet_transactions 只記 type(DEBIT/CREDIT/BONUS) + subType。
// 前端 UI 篩選器沿用 mock 的細分類型，這裡盡量映回後端可篩的 type；
// 後端不支援以 subType 篩選，故 checkin/task/payout 都會落在 CREDIT（結果較寬鬆）。
const TX_TYPE_TO_BACKEND = {
  bet: 'DEBIT',
  gift: 'DEBIT',
  payout: 'CREDIT',
  checkin: 'CREDIT',
  task: 'CREDIT',
}

// subType → 中文標籤（對齊 mock transactionLabels 的呈現）。
const TX_SUB_TYPE_LABELS = {
  BET: '下注',
  WIN: '派彩',
  CHECKIN: '簽到',
  TASK: '任務',
  GIFT: '贈送',
  GM_REWARD: 'GM 補發',
  BANKRUPTCY_AID: '破產補助',
  DIAMOND_EXCHANGE: '鑽石兌換',
  TOPUP: '加值',
  MONTHLY_REWARD: '每月簽到獎勵',
}

// 後端 WalletTransactionResponse → 前端交易列形狀（Transactions.jsx 讀 id/typeLabel/amount/status/createdAt）。
// 後端 amount 為正數量值；DEBIT 在前端以負數呈現（沿用 mock 的帶號 amount 慣例）。
function toTransactionRow(tx) {
  return {
    id: tx.id,
    type: tx.subType,
    typeLabel: TX_SUB_TYPE_LABELS[tx.subType] || tx.subType || tx.type,
    amount: tx.type === 'DEBIT' ? -tx.amount : tx.amount,
    status: '已完成',
    createdAt: tx.createdAt,
  }
}

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

  // GET /api/v1/wallet/checkin/status（端點實作在 member-service）→ 簽到狀態（後端權威）
  // 回傳 { month, signedDates[], monthCheckinDays, consecutiveDays, checkedInToday, milestones[] }。
  // 月曆已簽日期、本月累計天數、月度里程碑領取旗標皆以此為準（取代脆弱的 localStorage）。
  async getCheckInStatus(month) {
    if (useMockApi) {
      return mockApi.getCheckInStatus(month)
    }
    const params = month ? { month } : undefined
    const res = await api.get('/api/v1/wallet/checkin/status', { params })
    return res.data.data
  },

  // POST /api/v1/wallet/checkin/monthly-reward（端點實作在 member-service）→ 領取月度累計簽到獎勵。
  // 回應只含里程碑/金額，不含最新餘額，故領取成功後再查一次餘額組成 { reward, milestoneDays, wallet }。
  async claimMonthlyReward(milestoneDays) {
    if (useMockApi) {
      return mockApi.claimMonthlyReward(milestoneDays)
    }
    const res = await api.post('/api/v1/wallet/checkin/monthly-reward', { milestoneDays })
    const data = res.data.data
    const wallet = await walletApi.getBalance()
    return {
      reward: data.rewardAmount,
      milestoneDays: data.milestoneDays,
      monthCheckinDays: data.monthCheckinDays,
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

  // GET /api/v1/wallet/transactions → 帳務流水（CQRS 讀庫，分頁）。
  // 前端 page 為 1-based、後端為 0-based；回傳形狀對齊 walletSlice 期望的
  // { items, total, page(1-based), pageSize }。
  async getTransactions({ type = 'all', startDate = '', endDate = '', page = 1, pageSize = 8 } = {}) {
    if (useMockApi) {
      return mockApi.getTransactions({ type, startDate, endDate, page, pageSize })
    }

    const params = { page: Math.max(page - 1, 0), size: pageSize }
    const backendType = TX_TYPE_TO_BACKEND[type]
    if (backendType) params.type = backendType
    if (startDate) params.from = startDate
    if (endDate) params.to = endDate

    const res = await api.get('/api/v1/wallet/transactions', { params })
    const data = res.data.data // PagedResponse{ content, page, size, totalElements, totalPages }
    return {
      items: (data.content || []).map(toTransactionRow),
      total: data.totalElements,
      page: data.page + 1,
      pageSize: data.size,
    }
  },

  // POST /api/v1/wallet/gift → 好友贈幣（receiverId/amount/idempotencyKey）。
  // 贈送方由 gateway 注入的 X-User-Id 決定，不在 body。回應僅含 senderBalanceAfter，
  // 不含 frozenAmount，故再查一次餘額補齊 walletSlice 期望的 { wallet } 形狀。
  // ⚠️ 冪等鍵：後端以 idempotencyKey 去重防雙扣（wallet_transactions UNIQUE）。
  //   逾時/網路錯誤要「重試同一筆贈送」時，呼叫端**必須複用上一次的 idempotencyKey**，
  //   否則會生成新鍵被後端視為新交易→雙扣。未傳入才由此處生成一次性鍵（單發場景）。
  async giftCoins({ friendId, amount, idempotencyKey } = {}) {
    if (useMockApi) {
      return mockApi.giftCoins({ friendId, amount })
    }

    const body = {
      receiverId: friendId,
      amount,
      idempotencyKey:
        idempotencyKey || `gift-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    }
    const res = await api.post('/api/v1/wallet/gift', body)
    const gift = res.data.data
    const wallet = await walletApi.getBalance()
    return {
      wallet: { balance: wallet.balance, frozenAmount: wallet.frozenAmount },
      gift,
    }
  },
}
