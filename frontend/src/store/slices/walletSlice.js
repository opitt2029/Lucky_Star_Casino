import { createSlice } from '@reduxjs/toolkit'

const initialState = {
  balance: 0,
  frozenAmount: 0,
  loading: false,
  error: null,
}

const walletSlice = createSlice({
  name: 'wallet',
  initialState,
  reducers: {
    setBalance(state, action) {
      state.balance = action.payload.balance
      state.frozenAmount = action.payload.frozenAmount ?? state.frozenAmount
    },
    setLoading(state, action) {
      state.loading = action.payload
    },
    setError(state, action) {
      state.error = action.payload
    },
    resetWallet(state) {
      state.balance = 0
      state.frozenAmount = 0
      state.error = null
    },
  },
})

export const { setBalance, setLoading, setError, resetWallet } = walletSlice.actions
export default walletSlice.reducer
