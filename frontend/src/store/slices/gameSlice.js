import { createAsyncThunk, createSlice } from '@reduxjs/toolkit'
import { gameApi } from '../../services/gameApi'
import { extractError } from '../../services/memberApi'

const initialState = {
  currentGame: null,
  roundId: null,
  status: 'idle', // 'idle' | 'betting' | 'spinning' | 'result'
  result: null,
  latestResult: null,
  resultHistory: [],
  slotGrid: [
    ['🍒', '🍋', '🔔'],
    ['⭐', '7️⃣', '🍒'],
    ['🔔', '⭐', '7️⃣'],
  ],
  winningCells: [],
  baccaratRound: null,
  notifications: [],
  connectionStatus: 'DISCONNECTED',
  reconnectAttempt: 0,
  loading: false,
  error: null,
}

export const spinSlot = createAsyncThunk('game/spinSlot', async (payload, { rejectWithValue }) => {
  try {
    return await gameApi.spinSlot(payload)
  } catch (error) {
    return rejectWithValue(extractError(error))
  }
})

export const betBaccarat = createAsyncThunk('game/betBaccarat', async (payload, { rejectWithValue }) => {
  try {
    return await gameApi.baccaratBet(payload)
  } catch (error) {
    return rejectWithValue(extractError(error))
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
      state.latestResult = action.payload
      state.resultHistory = [action.payload, ...state.resultHistory].slice(0, 20)
      state.status = 'result'
      if (action.payload?.game === 'slot') {
        state.slotGrid = action.payload.grid ?? state.slotGrid
        state.winningCells = action.payload.winningCells ?? []
      }
      if (action.payload?.game === 'baccarat') {
        state.baccaratRound = action.payload
      }
    },
    updateGameResult(state, action) {
      const payload = action.payload
      const gameKey = payload.game || payload.gameId || null
      const normalizedResult = {
        ...payload,
        game: gameKey,
        receivedAt: payload.receivedAt || new Date().toISOString(),
      }

      state.currentGame = gameKey ?? state.currentGame
      state.result = normalizedResult
      state.latestResult = normalizedResult
      state.resultHistory = [normalizedResult, ...state.resultHistory].slice(0, 20)
      state.status = 'result'

      if (gameKey === 'slot') {
        state.slotGrid = payload.grid ?? state.slotGrid
        state.winningCells = payload.winningCells ?? state.winningCells
      }
      if (gameKey === 'baccarat') {
        state.baccaratRound = normalizedResult
      }
    },
    clearGameResult(state) {
      state.result = null
      state.latestResult = null
      state.resultHistory = []
      state.status = 'idle'
      state.winningCells = []
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
    resetGame() {
      return initialState
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
  updateGameResult,
  clearGameResult,
  setGameError,
  setConnectionStatus,
  pushNotification,
  clearNotifications,
  resetGame,
} = gameSlice.actions
export default gameSlice.reducer
