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
      playerCards: r.playerCards,
      bankerCards: r.bankerCards,
      playerPoints: r.playerScore,
      bankerPoints: r.bankerScore,
      wallet: r.wallet,
    }
  },
}
