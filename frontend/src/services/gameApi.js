import api from './api'
import { mockApi } from './mockApi'

const useMockApi = import.meta.env.VITE_USE_MOCK_API !== 'false'

// 封裝對 game-service（透過 Gateway）真實 API 的呼叫。
// 玩家身分由 gateway 驗證 JWT 後以 X-User-Id 注入，前端只需帶 access token（api.js 已處理）。
export const gameApi = {
  // POST /api/v1/game/slot/spin → 單次下注並轉動老虎機（同一回應揭露 serverSeed）。
  // 後端回應 data 形狀已與前端期望一致：
  // { roundId, game, grid, bet, multiplier, payout, winningCells, wallet:{balance,frozenAmount}, serverSeed, ... }
  async spinSlot({ bet, clientSeed }) {
    if (useMockApi) {
      return mockApi.spinSlot({ bet })
    }

    const res = await api.post('/api/v1/game/slot/spin', { bet, clientSeed })
    return res.data.data
  },

  // 百家樂兩階段：POST /bet（多區押注扣款）→ POST /{roundId}/result（結算派彩）。
  // 前端目前以單區 { area, amount } 下注，這裡轉接成後端的多區契約並合併結果，
  // 回傳與 mockApi.baccaratBet 一致的形狀供 gameSlice 使用。
  async baccaratBet({ area, amount, clientSeed }) {
    if (useMockApi) {
      return mockApi.baccaratBet({ area, amount })
    }

    const betBody = {
      player: area === 'player' ? amount : 0,
      banker: area === 'banker' ? amount : 0,
      tie: area === 'tie' ? amount : 0,
      clientSeed,
    }
    const betRes = await api.post('/api/v1/game/baccarat/bet', betBody)
    const roundId = betRes.data.data.roundId

    const settleRes = await api.post(`/api/v1/game/baccarat/${roundId}/result`)
    const r = settleRes.data.data

    return {
      roundId: r.roundId,
      game: 'baccarat',
      area,
      amount,
      winner: (r.result || '').toLowerCase(), // PLAYER/BANKER/TIE → player/banker/tie
      payout: r.payouts?.[area] ?? 0,
      rebate: r.rebate ?? 0,
      playerCards: r.playerCards,
      bankerCards: r.bankerCards,
      playerPoints: r.playerScore,
      bankerPoints: r.bankerScore,
      wallet: r.wallet,
    }
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
