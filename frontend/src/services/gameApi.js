import api from './api'
import { mockApi } from './mockApi'

const useMockApi = import.meta.env.VITE_USE_MOCK_API !== 'false'
function apiBaseUrl() {
  return import.meta.env.VITE_API_BASE_URL || ''
}

function authHeaders() {
  const token = localStorage.getItem('accessToken')
  return token ? { Authorization: `Bearer ${token}` } : {}
}

function keepalivePost(path) {
  if (typeof fetch !== 'function') return false
  try {
    fetch(`${apiBaseUrl()}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders(),
      },
      body: '{}',
      keepalive: true,
    }).catch(() => {})
    return true
  } catch {
    return false
  }
}

// 封裝對 game-service（透過 Gateway）真實 API 的呼叫。
// 玩家身分由 gateway 驗證 JWT 後以 X-User-Id 注入，前端只需帶 access token（api.js 已處理）。
function mapBaccaratResult(result, area, amount) {
  return {
    roundId: result.roundId,
    game: 'baccarat',
    area,
    amount,
    winner: (result.result || result.winner || '').toLowerCase(),
    payout: result.payout ?? result.payouts?.[area] ?? 0,
    rebate: result.rebate ?? 0,
    playerCards: result.playerCards,
    bankerCards: result.bankerCards,
    playerPoints: result.playerPoints ?? result.playerScore,
    bankerPoints: result.bankerPoints ?? result.bankerScore,
    wallet: result.wallet,
  }
}
export const gameApi = {
  // POST /api/v1/game/slot/spin → 單次下注並轉動老虎機（同一回應揭露 serverSeed）。
  // 後端回應 data 形狀已與前端期望一致：
  // { roundId, game, grid, bet, multiplier, payout, winningCells, wallet:{balance,frozenAmount}, serverSeed, ... }
  async prepareSlotRound({ bet, clientSeed }) {
    if (useMockApi) {
      return mockApi.prepareSlotRound({ bet, clientSeed })
    }
    const res = await api.post('/api/v1/game/slot/round', { bet, clientSeed })
    return res.data.data
  },

  async settleSlotRound({ roundId }) {
    if (useMockApi) {
      return mockApi.settleSlotRound({ roundId })
    }
    const res = await api.post(`/api/v1/game/slot/round/${roundId}/settle`)
    return res.data.data
  },
  async spinSlot({ bet, clientSeed }) {
    if (useMockApi) {
      return mockApi.spinSlot({ bet })
    }

    const res = await api.post('/api/v1/game/slot/spin', { bet, clientSeed })
    return res.data.data
  },

  // 百家樂兩階段：POST /bet（多區押注扣款）→ POST /{roundId}/result（結算派彩）。
  // 前端目前以單區 { area, amount } 下注，這裡轉接成後端的多區契約並合併結果，
  // 百家樂兩段式：/bet 只扣款建立 round，/{roundId}/result 才結算派彩。

  async baccaratPlaceBet({ area, amount, clientSeed }) {
    if (useMockApi) {
      return mockApi.baccaratPlaceBet({ area, amount, clientSeed })
    }

    const betBody = {
      player: area === 'player' ? amount : 0,
      banker: area === 'banker' ? amount : 0,
      tie: area === 'tie' ? amount : 0,
      clientSeed,
    }
    const res = await api.post('/api/v1/game/baccarat/bet', betBody)
    return {
      ...res.data.data,
      area,
      amount,
      game: 'baccarat',
    }
  },

  async baccaratSettle({ roundId, area, amount }) {
    if (useMockApi) {
      const result = await mockApi.baccaratSettle({ roundId, area, amount })
      return mapBaccaratResult(result, area, amount)
    }

    const res = await api.post(`/api/v1/game/baccarat/${roundId}/result`)
    return mapBaccaratResult(res.data.data, area, amount)
  },

  async baccaratBet({ area, amount, clientSeed }) {
    const bet = await gameApi.baccaratPlaceBet({ area, amount, clientSeed })
    return gameApi.baccaratSettle({ roundId: bet.roundId, area, amount })
  },
  // ---- 捕魚機（buy-in 制 + 批次射擊 + 結算）----
  // 玩家身分由 gateway 注入 X-User-Id；前端只需帶 access token（api.js 已處理）。

  // GET /session/active → 進行中場次（斷線重連恢復）；無場次回 null。
  async fishingActive() {
    if (useMockApi) {
      return mockApi.fishingActive()
    }
    const res = await api.get('/api/v1/game/fishing/session/active')
    return res.data.data ?? null
  },

  // POST /session/start → buy-in 開場（冪等扣款；已有場次則 resumed=true 續玩）。
  // betPerShot：玩家自選的單發面額（與砲台解耦，ADR-004）。
  async fishingStart({ buyIn, cannonLevel, betPerShot, clientSeed }) {
    if (useMockApi) {
      return mockApi.fishingStart({ buyIn, cannonLevel, betPerShot, clientSeed })
    }
    const res = await api.post('/api/v1/game/fishing/session/start', { buyIn, cannonLevel, betPerShot, clientSeed })
    return res.data.data
  },

  // POST /{sessionId}/shots → 批次射擊（只動局內餘額）。
  async fishingShots({ sessionId, shots }) {
    if (useMockApi) {
      return mockApi.fishingShots({ sessionId, shots })
    }
    const res = await api.post(`/api/v1/game/fishing/${sessionId}/shots`, { shots })
    return res.data.data
  },

  // POST /{sessionId}/end → 結算（剩餘局內餘額 credit 回 wallet、揭露 serverSeed）。
  async fishingTopUp({ sessionId, amount, clientRequestId }) {
    if (useMockApi) {
      return mockApi.fishingTopUp({ sessionId, amount, clientRequestId })
    }
    const res = await api.post(`/api/v1/game/fishing/${sessionId}/top-up`, { amount, clientRequestId })
    return res.data.data
  },

  async fishingEnd({ sessionId }) {
    if (useMockApi) {
      return mockApi.fishingEnd({ sessionId })
    }
    const res = await api.post(`/api/v1/game/fishing/${sessionId}/end`)
    return res.data.data
  },

  abandonSlotRound({ roundId, keepalive = false } = {}) {
    if (!roundId) return Promise.resolve(null)
    if (useMockApi) return Promise.resolve(mockApi.slotAbandon?.({ roundId }) ?? null)
    const path = `/api/v1/game/slot/round/${roundId}/abandon`
    if (keepalive) return Promise.resolve(keepalivePost(path))
    return api.post(path).then((res) => res.data.data)
  },

  abandonBaccaratRound({ roundId, keepalive = false } = {}) {
    if (!roundId) return Promise.resolve(null)
    if (useMockApi) return Promise.resolve(mockApi.baccaratAbandon?.({ roundId }) ?? null)
    const path = `/api/v1/game/baccarat/${roundId}/abandon`
    if (keepalive) return Promise.resolve(keepalivePost(path))
    return api.post(path).then((res) => res.data.data)
  },

  abandonFishing({ sessionId, keepalive = false } = {}) {
    if (!sessionId) return Promise.resolve(null)
    if (useMockApi) return Promise.resolve(mockApi.fishingAbandon?.({ sessionId }) ?? null)
    const path = `/api/v1/game/fishing/${sessionId}/abandon`
    if (keepalive) return Promise.resolve(keepalivePost(path))
    return api.post(path).then((res) => res.data.data)
  },
  // GET /api/v1/game/history → 玩家遊戲紀錄/注單分頁查詢。
  // 回傳 { items:[{ roundId, gameType, nonce, betAmount, winAmount, profit,
  //   balanceBefore, balanceAfter, betAt, settledAt, status, ... }], total, page, pageSize }。
  async gameHistory({ gameType = 'all', page = 1, pageSize = 10 } = {}) {
    if (useMockApi) {
      return mockApi.getGameHistory({ gameType, page, pageSize })
    }
    const params = { page, pageSize }
    if (gameType && gameType !== 'all') params.gameType = gameType
    const res = await api.get('/api/v1/game/history', { params })
    return res.data.data
  },

  // GET /{sessionId}/verify-shot → 結算後逐發公平性驗證（公開端點，無需登入）。
  // 回傳 { sessionId, shotSeq, fishType, betPerShot, commitmentValid, hit, payout,
  //        serverSeed, serverSeedHash, clientSeed, message }。
  async fishingVerifyShot({ sessionId, shotSeq, fishType, betPerShot }) {
    if (useMockApi) {
      return mockApi.fishingVerifyShot({ sessionId, shotSeq, fishType, betPerShot })
    }
    const res = await api.get(`/api/v1/game/fishing/${sessionId}/verify-shot`, {
      params: { shotSeq, fishType, betPerShot },
    })
    return res.data.data
  },
}
