import { createSlice } from '@reduxjs/toolkit'

const initialState = {
  globalRank: [],
  friendRank: [],
  dailyWinnings: [],
  myGlobalRank: null,
  loading: false,
  error: null,
}

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
  },
})

export const { setGlobalRank, setFriendRank, setDailyWinnings, setMyGlobalRank, setLoading, setError } =
  rankSlice.actions
export default rankSlice.reducer
