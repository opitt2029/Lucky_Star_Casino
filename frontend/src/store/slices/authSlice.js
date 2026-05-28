import { createAsyncThunk, createSlice } from '@reduxjs/toolkit'
import { memberApi, extractError } from '../../services/memberApi'

const initialState = {
  // 頁面重整時從 localStorage 還原 token，但 player 需等 fetchProfile 取回
  accessToken: localStorage.getItem('accessToken') || null,
  refreshToken: localStorage.getItem('refreshToken') || null,
  expiresIn: null,
  player: null,
  isAuthenticated: Boolean(localStorage.getItem('accessToken')),
  loading: false,
  error: null,
}

export const loginMember = createAsyncThunk('auth/loginMember', async (payload, { rejectWithValue }) => {
  try {
    return await memberApi.login(payload)
  } catch (error) {
    return rejectWithValue(extractError(error))
  }
})

export const registerMember = createAsyncThunk('auth/registerMember', async (payload, { rejectWithValue }) => {
  try {
    return await memberApi.register(payload)
  } catch (error) {
    return rejectWithValue(extractError(error))
  }
})

export const fetchProfile = createAsyncThunk('auth/fetchProfile', async (_, { rejectWithValue }) => {
  try {
    return await memberApi.getProfile()
  } catch (error) {
    return rejectWithValue(extractError(error))
  }
})

export const updateProfile = createAsyncThunk('auth/updateProfile', async (payload, { rejectWithValue }) => {
  try {
    return await memberApi.updateProfile(payload)
  } catch (error) {
    return rejectWithValue(extractError(error))
  }
})

export const logoutMember = createAsyncThunk('auth/logoutMember', async () => {
  await memberApi.logout()
})

function applySession(state, session) {
  state.accessToken = session.accessToken
  state.refreshToken = session.refreshToken
  state.expiresIn = session.expiresIn
  state.player = session.player
  state.isAuthenticated = true
  state.loading = false
  state.error = null
  localStorage.setItem('accessToken', session.accessToken)
  if (session.refreshToken) localStorage.setItem('refreshToken', session.refreshToken)
}

const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    loginSuccess(state, action) {
      const { accessToken, refreshToken, expiresIn, player } = action.payload
      state.accessToken = accessToken
      state.refreshToken = refreshToken ?? state.refreshToken
      state.expiresIn = expiresIn ?? state.expiresIn
      state.player = player
      state.isAuthenticated = true
      localStorage.setItem('accessToken', accessToken)
      if (refreshToken) localStorage.setItem('refreshToken', refreshToken)
    },
    logout(state) {
      state.accessToken = null
      state.refreshToken = null
      state.expiresIn = null
      state.player = null
      state.isAuthenticated = false
      state.loading = false
      state.error = null
      localStorage.removeItem('accessToken')
      localStorage.removeItem('refreshToken')
    },
    setPlayer(state, action) {
      state.player = action.payload
      state.isAuthenticated = true
    },
    clearAuthError(state) {
      state.error = null
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(loginMember.pending, (state) => {
        state.loading = true
        state.error = null
      })
      .addCase(loginMember.fulfilled, (state, action) => {
        applySession(state, action.payload)
      })
      .addCase(loginMember.rejected, (state, action) => {
        state.loading = false
        state.error = action.payload || '登入失敗'
      })
      .addCase(registerMember.pending, (state) => {
        state.loading = true
        state.error = null
      })
      .addCase(registerMember.fulfilled, (state, action) => {
        applySession(state, action.payload)
      })
      .addCase(registerMember.rejected, (state, action) => {
        state.loading = false
        state.error = action.payload || '註冊失敗'
      })
      .addCase(fetchProfile.fulfilled, (state, action) => {
        state.player = action.payload
      })
      .addCase(updateProfile.pending, (state) => {
        state.loading = true
        state.error = null
      })
      .addCase(updateProfile.fulfilled, (state, action) => {
        state.loading = false
        state.player = action.payload
      })
      .addCase(updateProfile.rejected, (state, action) => {
        state.loading = false
        state.error = action.payload || '更新失敗'
      })
      .addCase(logoutMember.fulfilled, (state) => {
        state.accessToken = null
        state.refreshToken = null
        state.expiresIn = null
        state.player = null
        state.isAuthenticated = false
        state.loading = false
        state.error = null
      })
  },
})

export const { loginSuccess, logout, setPlayer, clearAuthError } = authSlice.actions
export default authSlice.reducer
