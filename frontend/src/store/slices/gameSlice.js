import { createSlice } from '@reduxjs/toolkit'

const initialState = {
  currentGame: null,
  roundId: null,
  status: 'idle', // 'idle' | 'betting' | 'spinning' | 'result'
  result: null,
  error: null,
}

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
    },
    setGameError(state, action) {
      state.error = action.payload
      state.status = 'idle'
    },
    resetGame(state) {
      state.status = 'idle'
      state.result = null
      state.error = null
      state.roundId = null
    },
  },
})

export const { setCurrentGame, setBettingStatus, setSpinningStatus, setResult, setGameError, resetGame } =
  gameSlice.actions
export default gameSlice.reducer
