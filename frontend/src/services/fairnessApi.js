import api from './api'
import { provablyFairMock } from './provablyFairMock'

const useMock = import.meta.env.VITE_USE_MOCK_API !== 'false'

// 公平性展示頁專用 API：真實模式打 game-service（透過 gateway），mock 模式走本機密碼學模擬。
// 唯一的真/mock 分歧點——Panel 不知道自己在哪個模式（spec §5 職責邊界）。
export const fairnessApi = {
  isMock: useMock,

  // ---- 老虎機（commit-ahead 兩階段）----
  async slotRound({ bet, clientSeed }) {
    if (useMock) return provablyFairMock.slotRound({ bet, clientSeed })
    const res = await api.post('/api/v1/game/slot/round', { bet, clientSeed })
    return res.data.data
  },
  async slotSettle({ roundId }) {
    if (useMock) return provablyFairMock.slotSettle({ roundId })
    const res = await api.post(`/api/v1/game/slot/round/${roundId}/settle`)
    return res.data.data
  },

  // ---- 百家樂（bet 即扣款 → result 揭露）----
  async baccaratBet({ player, banker, tie, clientSeed }) {
    if (useMock) return provablyFairMock.baccaratBet({ player, banker, tie, clientSeed })
    const res = await api.post('/api/v1/game/baccarat/bet', { player, banker, tie, clientSeed })
    return res.data.data
  },
  async baccaratResult({ roundId }) {
    if (useMock) return provablyFairMock.baccaratResult({ roundId })
    const res = await api.post(`/api/v1/game/baccarat/${roundId}/result`)
    return res.data.data
  },

  // ---- 老虎機／百家樂共用驗證（serverSeed 選填；帶入竄改值即作弊演示）----
  async verifyRound({ roundId, serverSeed }) {
    if (useMock) return provablyFairMock.verifyRound({ roundId, serverSeed })
    const params = serverSeed ? { serverSeed } : {}
    const res = await api.get(`/api/v1/game/verify/${roundId}`, { params })
    return res.data.data
  },

  // ---- 捕魚機（場次級）----
  async fishingStart({ buyIn, cannonLevel, betPerShot, clientSeed }) {
    if (useMock) return provablyFairMock.fishingStart({ buyIn, cannonLevel, betPerShot, clientSeed })
    const res = await api.post('/api/v1/game/fishing/session/start', {
      buyIn,
      cannonLevel,
      betPerShot,
      clientSeed,
    })
    return res.data.data
  },
  async fishingShots({ sessionId, shots }) {
    if (useMock) return provablyFairMock.fishingShots({ sessionId, shots })
    const res = await api.post(`/api/v1/game/fishing/${sessionId}/shots`, { shots })
    return res.data.data
  },
  async fishingEnd({ sessionId }) {
    if (useMock) return provablyFairMock.fishingEnd({ sessionId })
    const res = await api.post(`/api/v1/game/fishing/${sessionId}/end`)
    return res.data.data
  },
  async fishingVerifyShot({ sessionId, shotSeq, fishType, betPerShot }) {
    if (useMock) return provablyFairMock.fishingVerifyShot({ sessionId, shotSeq, fishType, betPerShot })
    const res = await api.get(`/api/v1/game/fishing/${sessionId}/verify-shot`, {
      params: { shotSeq, fishType, betPerShot },
    })
    return res.data.data
  },
}
