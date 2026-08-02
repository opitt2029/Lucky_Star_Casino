import api from './api'

const useMockApi = import.meta.env.VITE_USE_MOCK_API !== 'false'
const MOCK_DIAMOND_KEY = 'lucky-star-diamond-wallet-v1'
const DIAMOND_EXCHANGE_RATE = 20
const DIAMOND_PROVISIONING_RETRY_DELAYS_MS = [300, 500, 800, 1200, 1600]

function waitForProvisioning(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isDiamondProvisioningPending(error) {
  if (error.response?.status !== 404) return false
  const message = String(error.response?.data?.message || error.response?.data?.error || error.message || '')
  return message.toLowerCase().includes('diamond wallet not found')
}

async function withDiamondProvisioningRetry(fn) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await fn()
    } catch (error) {
      if (attempt >= DIAMOND_PROVISIONING_RETRY_DELAYS_MS.length || !isDiamondProvisioningPending(error)) {
        throw error
      }
      await waitForProvisioning(DIAMOND_PROVISIONING_RETRY_DELAYS_MS[attempt])
    }
  }
}


function readMockDiamondBalance() {
  const stored = Number(localStorage.getItem(MOCK_DIAMOND_KEY))
  return Number.isFinite(stored) ? stored : 120
}

function writeMockDiamondBalance(balance) {
  localStorage.setItem(MOCK_DIAMOND_KEY, String(balance))
}

function makeIdempotencyKey(diamondAmount) {
  if (window.crypto?.randomUUID) {
    return `diamond-exchange-${window.crypto.randomUUID()}`
  }
  return `diamond-exchange-${Date.now()}-${diamondAmount}-${Math.random().toString(36).slice(2)}`
}

export const diamondApi = {
  async getDiamondBalance() {
    if (useMockApi) {
      return {
        balance: readMockDiamondBalance(),
        exchangeRate: DIAMOND_EXCHANGE_RATE,
      }
    }

    return withDiamondProvisioningRetry(async () => {
      const res = await api.get('/api/v1/wallet/diamond/balance')
      const data = res.data.data
      return {
        balance: data.balance,
        exchangeRate: data.exchangeRate ?? DIAMOND_EXCHANGE_RATE,
      }
    })
  },

  async redeemDiamondCard(card_code) {
    if (useMockApi) {
      const redeemedDiamonds = card_code.trim().toUpperCase().startsWith('TEST') ? 100 : 20
      const diamondBalance = readMockDiamondBalance() + redeemedDiamonds
      writeMockDiamondBalance(diamondBalance)
      return {
        cardCode: card_code,
        redeemedDiamonds,
        diamondBalance,
      }
    }

    const res = await api.post('/api/v1/wallet/diamond/redeem', {
      cardCode: card_code,
      card_code,
    })
    return res.data.data
  },

  async exchangeDiamondToStarCoin(diamondAmount) {
    const amount = Number(diamondAmount)

    if (useMockApi) {
      const currentDiamondBalance = readMockDiamondBalance()
      const diamondBalanceAfter = currentDiamondBalance - amount
      const starAmount = amount * DIAMOND_EXCHANGE_RATE
      writeMockDiamondBalance(diamondBalanceAfter)
      return {
        diamondAmount: amount,
        starAmount,
        diamondBalanceAfter,
      }
    }

    const res = await api.post('/api/v1/wallet/diamond/exchange', {
      diamondAmount: amount,
      idempotencyKey: makeIdempotencyKey(amount),
    })
    return res.data.data
  },
}

export const {
  getDiamondBalance,
  redeemDiamondCard,
  exchangeDiamondToStarCoin,
} = diamondApi
