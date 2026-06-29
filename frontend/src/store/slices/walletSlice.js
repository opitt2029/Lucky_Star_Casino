import { createAsyncThunk, createSlice } from '@reduxjs/toolkit'
import { walletApi } from '../../services/walletApi'
import { extractError } from '../../services/memberApi'

const initialState = {
  balance: 0,
  frozenAmount: 0,
  transactions: [],
  transactionTotal: 0,
  transactionPage: 1,
  transactionPageSize: 8,
  filters: {
    type: 'all',
    startDate: '',
    endDate: '',
  },
  checkIn: {
    loading: false,
    reward: null,
    consecutiveDays: null,
    message: '',
  },
  bankruptcyAid: {
    loading: false,
    amount: null,
    message: '',
    error: null,
  },
  gift: {
    loading: false,
    message: '',
    error: null,
  },
  loading: false,
  error: null,
}

export const fetchWallet = createAsyncThunk('wallet/fetchWallet', async (_, { rejectWithValue }) => {
  try {
    return await walletApi.getBalance()
  } catch (error) {
    return rejectWithValue(extractError(error))
  }
})

export const dailyCheckIn = createAsyncThunk('wallet/dailyCheckIn', async (_, { rejectWithValue }) => {
  try {
    return await walletApi.dailyCheckIn()
  } catch (error) {
    return rejectWithValue(extractError(error))
  }
})

export const claimBankruptcyAid = createAsyncThunk(
  'wallet/claimBankruptcyAid',
  async (_, { rejectWithValue }) => {
    try {
      return await walletApi.claimBankruptcyAid()
    } catch (error) {
      return rejectWithValue(extractError(error))
    }
  },
)

export const fetchTransactions = createAsyncThunk('wallet/fetchTransactions', async (params, { rejectWithValue }) => {
  try {
    return await walletApi.getTransactions(params)
  } catch (error) {
    return rejectWithValue(extractError(error))
  }
})

export const giftCoins = createAsyncThunk('wallet/giftCoins', async (payload, { rejectWithValue }) => {
  try {
    return await walletApi.giftCoins(payload)
  } catch (error) {
    return rejectWithValue(extractError(error))
  }
})

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
    setTransactionFilters(state, action) {
      state.filters = { ...state.filters, ...action.payload }
      state.transactionPage = 1
    },
    setTransactionPage(state, action) {
      state.transactionPage = action.payload
    },
    clearWalletNotice(state) {
      state.checkIn.message = ''
      state.checkIn.reward = null
      state.error = null
    },
    clearBankruptcyNotice(state) {
      state.bankruptcyAid.message = ''
      state.bankruptcyAid.amount = null
      state.bankruptcyAid.error = null
    },
    clearGiftNotice(state) {
      state.gift.message = ''
      state.gift.error = null
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchWallet.pending, (state) => {
        state.loading = true
        state.error = null
      })
      .addCase(fetchWallet.fulfilled, (state, action) => {
        state.loading = false
        state.balance = action.payload.balance
        state.frozenAmount = action.payload.frozenAmount ?? 0
      })
      .addCase(fetchWallet.rejected, (state, action) => {
        state.loading = false
        state.error = action.payload || '錢包同步失敗'
      })
      .addCase(dailyCheckIn.pending, (state) => {
        state.checkIn.loading = true
        state.checkIn.message = ''
        state.error = null
      })
      .addCase(dailyCheckIn.fulfilled, (state, action) => {
        state.checkIn.loading = false
        state.balance = action.payload.wallet.balance
        state.frozenAmount = action.payload.wallet.frozenAmount ?? 0
        state.checkIn.reward = action.payload.reward
        state.checkIn.consecutiveDays = action.payload.consecutiveDays
        state.checkIn.message = `簽到成功，連續 ${action.payload.consecutiveDays} 天，獲得 ${action.payload.reward.toLocaleString()} 星幣`
      })
      .addCase(dailyCheckIn.rejected, (state, action) => {
        state.checkIn.loading = false
        state.error = action.payload || '簽到失敗'
      })
      .addCase(claimBankruptcyAid.pending, (state) => {
        state.bankruptcyAid.loading = true
        state.bankruptcyAid.message = ''
        state.bankruptcyAid.error = null
      })
      .addCase(claimBankruptcyAid.fulfilled, (state, action) => {
        state.bankruptcyAid.loading = false
        state.balance = action.payload.wallet.balance
        state.frozenAmount = action.payload.wallet.frozenAmount ?? 0
        state.bankruptcyAid.amount = action.payload.amount
        state.bankruptcyAid.message = `已領取破產補助 ${action.payload.amount.toLocaleString()} 星幣`
      })
      .addCase(claimBankruptcyAid.rejected, (state, action) => {
        state.bankruptcyAid.loading = false
        state.bankruptcyAid.error = action.payload || '破產補助領取失敗'
      })
      .addCase(fetchTransactions.pending, (state) => {
        state.loading = true
        state.error = null
      })
      .addCase(fetchTransactions.fulfilled, (state, action) => {
        state.loading = false
        state.transactions = action.payload.items
        state.transactionTotal = action.payload.total
        state.transactionPage = action.payload.page
        state.transactionPageSize = action.payload.pageSize
      })
      .addCase(fetchTransactions.rejected, (state, action) => {
        state.loading = false
        state.error = action.payload || '交易紀錄讀取失敗'
      })
      .addCase(giftCoins.pending, (state) => {
        state.gift.loading = true
        state.gift.message = ''
        state.gift.error = null
      })
      .addCase(giftCoins.fulfilled, (state, action) => {
        state.gift.loading = false
        state.balance = action.payload.wallet.balance
        state.frozenAmount = action.payload.wallet.frozenAmount ?? 0
        state.gift.message = '贈送成功'
      })
      .addCase(giftCoins.rejected, (state, action) => {
        state.gift.loading = false
        state.gift.error = action.payload || '贈送失敗'
      })
  },
})

export const {
  setBalance,
  setLoading,
  setError,
  resetWallet,
  setTransactionFilters,
  setTransactionPage,
  clearWalletNotice,
  clearBankruptcyNotice,
  clearGiftNotice,
} = walletSlice.actions
export default walletSlice.reducer
