import { createAsyncThunk, createSlice } from '@reduxjs/toolkit'
import { rankApi } from '../../services/rankApi'

const initialState = {
  globalRank: [],
  friendRank: [],
  dailyWinnings: [],
  myGlobalRank: null,
  activeTab: 'global',
  searchQuery: '',
  loading: false,
  error: null,
}

export const fetchRanks = createAsyncThunk('rank/fetchRanks', async (_, { getState, rejectWithValue }) => {
  try {
    const playerId = getState().auth.player?.id
    return await rankApi.getRanks(playerId)
  } catch (error) {
    return rejectWithValue(error.message)
  }
})

const rankSlice = createSlice({
  name: 'rank',
  initialState,
  reducers: {
    setGlobalRank(state, action) {
      state.globalRank = action.payload
    },
    setFriendRank(state, action) {
      state.friendRank = action.payload
    },
    setDailyWinnings(state, action) {
      state.dailyWinnings = action.payload
    },
    setMyGlobalRank(state, action) {
      state.myGlobalRank = action.payload
    },
    setLoading(state, action) {
      state.loading = action.payload
    },
    setError(state, action) {
      state.error = action.payload
    },
    setRankTab(state, action) {
      state.activeTab = action.payload
    },
    setRankSearchQuery(state, action) {
      state.searchQuery = action.payload
    },
    upsertRankRows(state, action) {
      const incomingRows = action.payload.items || action.payload
      const merged = [...incomingRows, ...state.globalRank]
      // 以 playerId（id）為去重鍵；後端即時事件帶 playerId，暱稱可能重複/變動，不適合當鍵。
      const uniqueRows = Array.from(new Map(merged.map((row) => [row.id ?? row.nickname, row])).values())
      state.globalRank = uniqueRows.sort((a, b) => b.score - a.score).slice(0, 100)
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchRanks.pending, (state) => {
        state.loading = true
        state.error = null
      })
      .addCase(fetchRanks.fulfilled, (state, action) => {
        state.loading = false
        state.globalRank = action.payload.globalRank
        state.friendRank = action.payload.friendRank
        state.myGlobalRank = action.payload.myGlobalRank
      })
      .addCase(fetchRanks.rejected, (state, action) => {
        state.loading = false
        state.error = action.payload || '排行榜讀取失敗'
      })
  },
})

export const {
  setGlobalRank,
  setFriendRank,
  setDailyWinnings,
  setMyGlobalRank,
  setLoading,
  setError,
  setRankTab,
  setRankSearchQuery,
  upsertRankRows,
} = rankSlice.actions
export default rankSlice.reducer
