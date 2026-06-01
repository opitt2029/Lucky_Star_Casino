import { createAsyncThunk, createSlice } from '@reduxjs/toolkit'
import { mockApi } from '../../services/mockApi'

const initialState = {
  currentGame: null,
  roundId: null,
  status: 'idle', // 'idle' | 'betting' | 'spinning' | 'result'
  result: null,
  slotGrid: [
    ['🍒', '🍋', '🔔'],
    ['⭐', '7️⃣', '🍒'],
    ['🔔', '⭐', '7️⃣'],
  ],
  winningCells: [],
  baccaratRound: null,
  notifications: [],
  connectionStatus: 'idle',
  reconnectAttempt: 0,
  loading: false,
  error: null,
}

export const spinSlot = createAsyncThunk('game/spinSlot', async (payload, { rejectWithValue }) => {
  try {
    return await mockApi.spinSlot(payload)
  } catch (error) {
    return rejectWithValue(error.message)
  }
})

export const betBaccarat = createAsyncThunk('game/betBaccarat', async (payload, { rejectWithValue }) => {
  try {
    return await mockApi.baccaratBet(payload)
  } catch (error) {
    return rejectWithValue(error.message)
  }
})

const gameSlice = createSlice({
  name: 'game',
  initialState,
  reducers: {
    setCurrentGame(state, action) {
      state.currentGame = action.payload
      state.status = 'idle'
      state.result = null
      state.error = null
    },
    setBettingStatus(state) {
      state.status = 'betting'
    },
    setSpinningStatus(state, action) {
      state.status = 'spinning'
      state.roundId = action.payload?.roundId ?? null
    },
    setResult(state, action) {
      state.result = action.payload
      state.status = 'result'
      if (action.payload?.game === 'slot') {
        state.slotGrid = action.payload.grid ?? state.slotGrid
        state.winningCells = action.payload.winningCells ?? []
      }
      if (action.payload?.game === 'baccarat') {
        state.baccaratRound = action.payload
      }
    },
    setGameError(state, action) {
      state.error = action.payload
      state.status = 'idle'
    },
    setConnectionStatus(state, action) {
      state.connectionStatus = action.payload.status
      state.reconnectAttempt = action.payload.reconnectAttempt ?? state.reconnectAttempt
    },
    pushNotification(state, action) {
      state.notifications = [action.payload, ...state.notifications].slice(0, 20)
    },
    clearNotifications(state) {
      state.notifications = []
    },
    resetGame(state) {
      state.status = 'idle'
      state.result = null
      state.error = null
      state.roundId = null
      state.winningCells = []
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(spinSlot.pending, (state) => {
        state.currentGame = 'slot'
        state.status = 'spinning'
        state.loading = true
        state.error = null
        state.winningCells = []
      })
      .addCase(spinSlot.fulfilled, (state, action) => {
        state.loading = false
        state.status = 'result'
        state.roundId = action.payload.roundId
        state.result = action.payload
        state.slotGrid = action.payload.grid
        state.winningCells = action.payload.winningCells
      })
      .addCase(spinSlot.rejected, (state, action) => {
        state.loading = false
        state.status = 'idle'
        state.error = action.payload || '老虎機下注失敗'
      })
      .addCase(betBaccarat.pending, (state) => {
        state.currentGame = 'baccarat'
        state.status = 'betting'
        state.loading = true
        state.error = null
      })
      .addCase(betBaccarat.fulfilled, (state, action) => {
        state.loading = false
        state.status = 'result'
        state.roundId = action.payload.roundId
        state.result = action.payload
        state.baccaratRound = action.payload
      })
      .addCase(betBaccarat.rejected, (state, action) => {
        state.loading = false
        state.status = 'idle'
        state.error = action.payload || '百家樂下注失敗'
      })
  },
})

export const {
  setCurrentGame,
  setBettingStatus,
  setSpinningStatus,
  setResult,
  setGameError,
  setConnectionStatus,
  pushNotification,
  clearNotifications,
  resetGame,
} = gameSlice.actions
export default gameSlice.reducer
