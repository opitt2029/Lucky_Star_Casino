import { createAsyncThunk, createSlice } from '@reduxjs/toolkit'
import { diamondApi } from '../../services/diamondApi'
import { extractError } from '../../services/memberApi'

const initialState = {
  diamondBalance: 0,
  exchangeRate: 20,
  loading: false,
  error: null,
  lastRedeemAmount: 0,
  successMessage: '',
}

export const fetchDiamondBalance = createAsyncThunk(
  'diamond/fetchDiamondBalance',
  async (_, { rejectWithValue }) => {
    try {
      return await diamondApi.getDiamondBalance()
    } catch (error) {
      return rejectWithValue(extractError(error))
    }
  },
)

const diamondSlice = createSlice({
  name: 'diamond',
  initialState,
  reducers: {
    setDiamondBalance(state, action) {
      state.diamondBalance = action.payload
    },
    setDiamondLoading(state, action) {
      state.loading = action.payload
    },
    setDiamondError(state, action) {
      state.error = action.payload
    },
    setLastRedeemAmount(state, action) {
      state.lastRedeemAmount = action.payload
    },
    setDiamondSuccessMessage(state, action) {
      state.successMessage = action.payload
    },
    clearDiamondMessage(state) {
      state.error = null
      state.lastRedeemAmount = 0
      state.successMessage = ''
    },
    resetDiamond(state) {
      state.diamondBalance = 0
      state.exchangeRate = 20
      state.loading = false
      state.error = null
      state.lastRedeemAmount = 0
      state.successMessage = ''
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchDiamondBalance.pending, (state) => {
        state.loading = true
        state.error = null
      })
      .addCase(fetchDiamondBalance.fulfilled, (state, action) => {
        state.loading = false
        state.diamondBalance = action.payload.balance
        state.exchangeRate = action.payload.exchangeRate ?? 20
      })
      .addCase(fetchDiamondBalance.rejected, (state, action) => {
        state.loading = false
        state.error = action.payload || '鑽石餘額同步失敗'
      })
  },
})

export const {
  setDiamondBalance,
  setDiamondLoading,
  setDiamondError,
  setLastRedeemAmount,
  setDiamondSuccessMessage,
  clearDiamondMessage,
  resetDiamond,
} = diamondSlice.actions
export default diamondSlice.reducer
