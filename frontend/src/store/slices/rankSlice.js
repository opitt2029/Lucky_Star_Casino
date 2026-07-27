import { createAsyncThunk, createSlice } from '@reduxjs/toolkit'
import { rankApi, RANK_CATEGORIES, RANK_SCOPES } from '../../services/rankApi'

export const rankKey = (scope, category) => `${scope}:${category}`

const emptyRankings = Object.fromEntries(
  RANK_SCOPES.flatMap((scope) => RANK_CATEGORIES.map((category) => [rankKey(scope, category), []])),
)

function normalizeRankRows(rows = []) {
  return rows.map((row, index) => ({
    ...row,
    rank: Number(row.rank) > 0 ? Number(row.rank) : index + 1,
    provisionalRank: false,
  }))
}

const initialState = {
  activeScope: 'GLOBAL',
  activeCategory: 'COINS',
  searchQuery: '',
  rankings: emptyRankings,
  myRanks: {},
  selectedPlayerId: null,
  selectedPlayer: null,
  loading: false,
  refreshing: false,
  playerLoading: false,
  lastUpdatedAt: null,
  error: null,
  myRanksError: null,
  playerError: null,
  requests: {},
}

export const fetchLeaderboard = createAsyncThunk(
  'rank/fetchLeaderboard',
  async ({ scope = 'GLOBAL', category = 'COINS', limit = 100, refresh = false } = {}, { rejectWithValue }) => {
    try {
      const rows = await rankApi.getLeaderboard({ scope, category, limit })
      return { scope, category, rows, refresh, fetchedAt: new Date().toISOString() }
    } catch (error) {
      return rejectWithValue(error?.response?.data?.message || error.message || '排行榜讀取失敗')
    }
  },
)

export const fetchMyRanks = createAsyncThunk('rank/fetchMyRanks', async (_, { rejectWithValue }) => {
  try {
    return await rankApi.getMyRanks()
  } catch (error) {
    return rejectWithValue(error?.response?.data?.message || error.message || '我的名次讀取失敗')
  }
})

export const fetchRankPlayer = createAsyncThunk(
  'rank/fetchRankPlayer',
  async ({ playerId, scope = 'GLOBAL', category = 'COINS' }, { rejectWithValue }) => {
    try {
      return await rankApi.getRankPlayer(playerId, { scope, category })
    } catch (error) {
      const status = error?.response?.status
      if (status === 404) return rejectWithValue('找不到這位玩家')
      return rejectWithValue(error?.response?.data?.message || error.message || '玩家資料讀取失敗')
    }
  },
)

export const refreshActiveLeaderboard = createAsyncThunk(
  'rank/refreshActiveLeaderboard',
  async (_, { dispatch, getState }) => {
    const { activeScope, activeCategory } = getState().rank
    const action = await dispatch(
      fetchLeaderboard({ scope: activeScope, category: activeCategory, refresh: true }),
    )
    if (fetchLeaderboard.rejected.match(action)) throw new Error(action.payload)
    return action.payload
  },
)

export const fetchRanks = createAsyncThunk('rank/fetchRanks', async (_, { dispatch }) => {
  await Promise.all([
    dispatch(fetchLeaderboard({ scope: 'GLOBAL', category: 'COINS' })),
    dispatch(fetchLeaderboard({ scope: 'FRIENDS', category: 'COINS' })),
    dispatch(fetchLeaderboard({ scope: 'GLOBAL', category: 'DAILY_WINNINGS' })),
    dispatch(fetchMyRanks()),
  ])
  return true
})

const rankSlice = createSlice({
  name: 'rank',
  initialState,
  reducers: {
    setRankScope(state, action) {
      state.activeScope = action.payload
      state.error = null
      state.playerError = null
    },
    setRankCategory(state, action) {
      state.activeCategory = action.payload
      state.error = null
      state.playerError = null
    },
    setRankSearchQuery(state, action) {
      state.searchQuery = action.payload
    },
    clearSelectedRankPlayer(state) {
      state.selectedPlayerId = null
      state.selectedPlayer = null
      state.playerError = null
    },
    setRankTab(state, action) {
      const tab = action.payload
      if (tab === 'friends') {
        state.activeScope = 'FRIENDS'
        state.activeCategory = 'COINS'
      } else if (tab === 'daily') {
        state.activeScope = 'GLOBAL'
        state.activeCategory = 'DAILY_WINNINGS'
      } else {
        state.activeScope = 'GLOBAL'
        state.activeCategory = 'COINS'
      }
      state.error = null
    },
    upsertRankRows(state, action) {
      const scope = action.payload?.scope || 'GLOBAL'
      const category = action.payload?.category || 'COINS'
      const key = rankKey(scope, category)
      const incomingRows = action.payload?.items || action.payload || []
      if (!Array.isArray(incomingRows) || incomingRows.length === 0) return
      const merged = [...incomingRows, ...(state.rankings[key] || [])]
      const uniqueRows = Array.from(
        new Map(merged.map((row) => [String(row.playerId ?? row.id), row])).values(),
      )
      state.rankings[key] = uniqueRows
        .sort((a, b) => Number(b.score || 0) - Number(a.score || 0) || Number(a.playerId ?? a.id) - Number(b.playerId ?? b.id))
        .slice(0, 100)
        .map((row, index) => ({ ...row, rank: index + 1, provisionalRank: true }))
      state.lastUpdatedAt = action.payload?.updatedAt || new Date().toISOString()
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchLeaderboard.pending, (state, action) => {
        const { scope = 'GLOBAL', category = 'COINS', refresh = false } = action.meta.arg || {}
        const key = rankKey(scope, category)
        state.requests[key] = action.meta.requestId
        state.error = null
        if (refresh || (state.rankings[key] || []).length > 0) state.refreshing = true
        else state.loading = true
      })
      .addCase(fetchLeaderboard.fulfilled, (state, action) => {
        const key = rankKey(action.payload.scope, action.payload.category)
        if (state.requests[key] !== action.meta.requestId) return
        state.rankings[key] = normalizeRankRows(action.payload.rows)
        state.lastUpdatedAt = action.payload.fetchedAt
        state.loading = false
        state.refreshing = false
        state.error = null
        delete state.requests[key]
      })
      .addCase(fetchLeaderboard.rejected, (state, action) => {
        const { scope = 'GLOBAL', category = 'COINS' } = action.meta.arg || {}
        const key = rankKey(scope, category)
        if (state.requests[key] !== action.meta.requestId) return
        state.loading = false
        state.refreshing = false
        state.error = action.payload || '排行榜讀取失敗'
        delete state.requests[key]
      })
      .addCase(fetchMyRanks.pending, (state) => {
        state.myRanksError = null
      })
      .addCase(fetchMyRanks.fulfilled, (state, action) => {
        state.myRanks = action.payload || {}
        state.myRanksError = null
      })
      .addCase(fetchMyRanks.rejected, (state, action) => {
        state.myRanksError = action.payload || '我的名次讀取失敗'
      })
      .addCase(fetchRankPlayer.pending, (state, action) => {
        state.selectedPlayerId = action.meta.arg.playerId
        state.selectedPlayer = null
        state.playerLoading = true
        state.playerError = null
      })
      .addCase(fetchRankPlayer.fulfilled, (state, action) => {
        state.selectedPlayer = action.payload
        state.playerLoading = false
      })
      .addCase(fetchRankPlayer.rejected, (state, action) => {
        state.playerLoading = false
        state.playerError = action.payload || '玩家資料讀取失敗'
      })
  },
})

export const {
  setRankScope,
  setRankCategory,
  setRankSearchQuery,
  setRankTab,
  clearSelectedRankPlayer,
  upsertRankRows,
} = rankSlice.actions
export default rankSlice.reducer
