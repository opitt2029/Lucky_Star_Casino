import api from './api'
import { mockApi } from './mockApi'

const useMockApi = import.meta.env.VITE_USE_MOCK_API !== 'false'

export const RANK_SCOPES = ['GLOBAL', 'FRIENDS']
export const RANK_CATEGORIES = ['COINS', 'DAILY_WINNINGS', 'SLOT', 'BACCARAT', 'FISHING']

function toRow(entry = {}) {
  const id = entry.playerId ?? entry.id
  const nickname = entry.nickname || entry.name || entry.username || `玩家 ${id ?? ''}`.trim()
  return {
    id,
    playerId: id,
    username: entry.username || null,
    nickname,
    name: nickname,
    avatarUrl: entry.avatarUrl || entry.avatar || '',
    rank: Number(entry.rank ?? 0),
    score: Number(entry.score ?? 0),
    scoreUnit: entry.scoreUnit || '星幣',
    roundCount: entry.roundCount ?? null,
    totalBet: entry.totalBet ?? null,
    totalPayout: entry.totalPayout ?? null,
    winRate: entry.winRate ?? null,
    trend: entry.trend || '',
  }
}

function keyOf(scope, category) {
  return `${scope}:${category}`
}

export const rankApi = {
  async getLeaderboard({ scope = 'GLOBAL', category = 'COINS', limit = 100 } = {}) {
    if (useMockApi) {
      return (await mockApi.getLeaderboard({ scope, category, limit })).map(toRow)
    }
    const response = await api.get('/api/v1/rank/leaderboard', {
      params: { scope, category, limit },
    })
    return (response.data || []).map(toRow)
  },

  async getMyRanks() {
    if (useMockApi) return mockApi.getMyRanks()
    const response = await api.get('/api/v1/rank/me')
    return Object.fromEntries(
      Object.entries(response.data || {}).map(([key, value]) => [key, toRow(value)]),
    )
  },

  async getRankPlayer(playerId, { scope = 'GLOBAL', category = 'COINS' } = {}) {
    if (useMockApi) return mockApi.getRankPlayer(playerId, { scope, category })
    const response = await api.get(`/api/v1/rank/players/${playerId}`, {
      params: { scope, category },
    })
    return response.data
  },

  async getRanks(playerId) {
    if (useMockApi && mockApi.getRank) return mockApi.getRank()
    const [globalRank, friendRank, dailyWinnings, myRanks] = await Promise.all([
      this.getLeaderboard({ scope: 'GLOBAL', category: 'COINS' }),
      this.getLeaderboard({ scope: 'FRIENDS', category: 'COINS', limit: 100 }),
      this.getLeaderboard({ scope: 'GLOBAL', category: 'DAILY_WINNINGS' }),
      playerId == null ? Promise.resolve({}) : this.getMyRanks(),
    ])
    return {
      globalRank,
      friendRank,
      dailyWinnings,
      myGlobalRank: myRanks[keyOf('GLOBAL', 'COINS')] || null,
      myDailyWinnings: myRanks[keyOf('GLOBAL', 'DAILY_WINNINGS')] || null,
    }
  },

  normalizeBroadcast(payload) {
    const entries = payload?.entries
    return {
      scope: payload?.scope || 'GLOBAL',
      category: payload?.category || 'COINS',
      items: Array.isArray(entries) ? entries.map(toRow) : [],
      updatedAt: payload?.updatedAt || new Date().toISOString(),
    }
  },
}
