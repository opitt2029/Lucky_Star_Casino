import api from './api'
import { mockApi } from './mockApi'

const useMockApi = import.meta.env.VITE_USE_MOCK_API !== 'false'

// 後端 RankEntryResponse { playerId, username, rank, score } → 前端榜單列形狀。
// 與 mockApi.getRank 的 { id, nickname, score } 對齊，讓 Rank.jsx / LeaderboardPanel 共用同一份欄位。
function toRow(entry) {
  return {
    id: entry.playerId,
    nickname: entry.username,
    score: entry.score,
    rank: entry.rank,
  }
}

// 封裝對 rank-service（透過 Gateway）真實 API 的呼叫。
// 玩家身分由 gateway 驗證 JWT 後以 X-User-Id 注入，好友榜不需另帶參數。
export const rankApi = {
  // 全球榜 + 好友榜 + 我的名次。mock 模式沿用 mockApi.getRank 既有形狀。
  async getRanks(playerId) {
    if (useMockApi) {
      return mockApi.getRank()
    }

    // RankController 直接回傳 List<RankEntryResponse>（未包 ApiResponse），故取 res.data。
    const [globalRes, friendRes] = await Promise.all([
      api.get('/api/v1/rank/global'),
      api.get('/api/v1/rank/friends'),
    ])
    const globalRank = (globalRes.data || []).map(toRow)
    const friendRank = (friendRes.data || []).map(toRow)

    let myGlobalRank = null
    if (playerId != null) {
      try {
        const me = (await api.get(`/api/v1/rank/global/${playerId}`)).data
        myGlobalRank = { rank: me.rank, nickname: me.username, score: me.score }
      } catch (error) {
        // 未上榜時後端回 404，視為「無名次」，不應擋住整個榜單載入。
        if (error?.response?.status !== 404) throw error
      }
    }

    return { globalRank, friendRank, myGlobalRank }
  },

  // 即時 /topic/rank 廣播（RankUpdateEvent { type, entries:[RankEntryResponse], updatedAt }）
  // → 前端榜單列陣列，與 getRanks 同一形狀，供 RealtimeBridge upsert 進 globalRank。
  normalizeBroadcast(payload) {
    const entries = payload?.entries
    return Array.isArray(entries) ? entries.map(toRow) : []
  },
}
