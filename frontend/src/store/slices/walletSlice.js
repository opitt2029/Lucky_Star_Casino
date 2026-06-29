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
  // 簽到狀態（後端權威）：月曆已簽日期、本月累計天數、月度里程碑領取旗標
  checkInStatus: {
    loading: false,
    month: '',
    signedDates: [],
    monthCheckinDays: 0,
    consecutiveDays: 0,
    checkedInToday: false,
    milestones: [],
    error: null,
  },
  // 領取月度累計簽到獎勵的狀態
  monthlyReward: {
    claiming: false,
    message: '',
    error: null,
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

export const dailyCheckIn = createAsyncThunk('wallet/dailyCheckIn', async (_, { dispatch, rejectWithValue }) => {
  try {
    const result = await walletApi.dailyCheckIn()
    // 簽到成功後刷新後端權威狀態（月曆/累計天數/里程碑），CheckIn.jsx 不再可能漏存日期
    dispatch(fetchCheckInStatus())
    return result
  } catch (error) {
    return rejectWithValue(extractError(error))
  }
})

export const fetchCheckInStatus = createAsyncThunk(
  'wallet/fetchCheckInStatus',
  async (month, { rejectWithValue }) => {
    try {
      return await walletApi.getCheckInStatus(month)
    } catch (error) {
      return rejectWithValue(extractError(error))
    }
  },
)

export const claimMonthlyReward = createAsyncThunk(
  'wallet/claimMonthlyReward',
  async (milestoneDays, { dispatch, rejectWithValue }) => {
    try {
      const result = await walletApi.claimMonthlyReward(milestoneDays)
      // 領取成功後刷新簽到狀態，讓里程碑改為「已領取」
      dispatch(fetchCheckInStatus())
      return result
    } catch (error) {
      return rejectWithValue(extractError(error))
    }
  },
)

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
    clearMonthlyRewardNotice(state) {
      state.monthlyReward.message = ''
      state.monthlyReward.error = null
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
      .addCase(fetchCheckInStatus.pending, (state) => {
        state.checkInStatus.loading = true
        state.checkInStatus.error = null
      })
      .addCase(fetchCheckInStatus.fulfilled, (state, action) => {
        const p = action.payload
        state.checkInStatus.loading = false
        state.checkInStatus.month = p.month
        state.checkInStatus.signedDates = p.signedDates || []
        state.checkInStatus.monthCheckinDays = p.monthCheckinDays ?? 0
        state.checkInStatus.consecutiveDays = p.consecutiveDays ?? 0
        state.checkInStatus.checkedInToday = p.checkedInToday ?? false
        state.checkInStatus.milestones = p.milestones || []
      })
      .addCase(fetchCheckInStatus.rejected, (state, action) => {
        state.checkInStatus.loading = false
        state.checkInStatus.error = action.payload || '簽到狀態讀取失敗'
      })
      .addCase(claimMonthlyReward.pending, (state) => {
        state.monthlyReward.claiming = true
        state.monthlyReward.message = ''
        state.monthlyReward.error = null
      })
      .addCase(claimMonthlyReward.fulfilled, (state, action) => {
        state.monthlyReward.claiming = false
        state.balance = action.payload.wallet.balance
        state.frozenAmount = action.payload.wallet.frozenAmount ?? 0
        state.monthlyReward.message = `已領取每月簽到獎勵 ${action.payload.reward.toLocaleString()} 星幣`
      })
      .addCase(claimMonthlyReward.rejected, (state, action) => {
        state.monthlyReward.claiming = false
        state.monthlyReward.error = action.payload || '每月簽到獎勵領取失敗'
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
  clearMonthlyRewardNotice,
} = walletSlice.actions
export default walletSlice.reducer
