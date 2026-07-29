import { createAsyncThunk, createSlice } from '@reduxjs/toolkit'
import { memberApi, extractError } from '../../services/memberApi'

const initialAccessToken = localStorage.getItem('accessToken') || null
const initialRefreshToken = localStorage.getItem('refreshToken') || null

const initialState = {
  accessToken: initialAccessToken,
  refreshToken: initialRefreshToken,
  expiresIn: null,
  player: null,
  authStatus: initialAccessToken ? 'checking' : 'guest',
  isAuthenticated: false,
  profileLoading: false,
  loading: false,
  error: null,
  sessionError: null,
}

export const loginMember = createAsyncThunk('auth/loginMember', async (payload, { rejectWithValue }) => {
  try {
    return await memberApi.login(payload)
  } catch (error) {
    return rejectWithValue(extractError(error))
  }
})

export const socialLoginMember = createAsyncThunk(
  'auth/socialLoginMember',
  async (ticket, { rejectWithValue }) => {
    try {
      return await memberApi.exchangeSocialLogin(ticket)
    } catch (error) {
      return rejectWithValue(extractError(error))
    }
  },
)

export const registerSocialMember = createAsyncThunk(
  'auth/registerSocialMember',
  async (payload, { rejectWithValue }) => {
    try {
      return await memberApi.registerSocial(payload)
    } catch (error) {
      return rejectWithValue(extractError(error))
    }
  },
)

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

function removeStoredTokens() {
  localStorage.removeItem('accessToken')
  localStorage.removeItem('refreshToken')
}

function clearSessionState(state) {
  state.accessToken = null
  state.refreshToken = null
  state.expiresIn = null
  state.player = null
  state.authStatus = 'guest'
  state.isAuthenticated = false
  state.profileLoading = false
  state.loading = false
  state.error = null
  removeStoredTokens()
}

function applySession(state, session) {
  state.accessToken = session.accessToken
  state.refreshToken = session.refreshToken
  state.expiresIn = session.expiresIn
  state.player = session.player
  state.authStatus = 'authenticated'
  state.isAuthenticated = true
  state.profileLoading = false
  state.loading = false
  state.error = null
  state.sessionError = null
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
      state.authStatus = 'authenticated'
      state.isAuthenticated = true
      state.profileLoading = false
      state.sessionError = null
      localStorage.setItem('accessToken', accessToken)
      if (refreshToken) localStorage.setItem('refreshToken', refreshToken)
    },
    logout(state) {
      clearSessionState(state)
      state.sessionError = null
    },
    tokenRefreshed(state, action) {
      const { accessToken, refreshToken, expiresIn } = action.payload
      state.accessToken = accessToken
      if (refreshToken) state.refreshToken = refreshToken
      if (expiresIn != null) state.expiresIn = expiresIn
      state.authStatus = state.player ? 'authenticated' : 'checking'
      state.isAuthenticated = Boolean(state.player)
      state.sessionError = null
      localStorage.setItem('accessToken', accessToken)
      if (refreshToken) localStorage.setItem('refreshToken', refreshToken)
    },
    setPlayer(state, action) {
      state.player = action.payload
      state.authStatus = 'authenticated'
      state.isAuthenticated = true
      state.profileLoading = false
      state.sessionError = null
    },
    clearAuthError(state) {
      state.error = null
      state.sessionError = null
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(loginMember.pending, (state) => {
        state.loading = true
        state.error = null
        state.sessionError = null
      })
      .addCase(loginMember.fulfilled, (state, action) => {
        applySession(state, action.payload)
      })
      .addCase(loginMember.rejected, (state, action) => {
        state.authStatus = 'guest'
        state.isAuthenticated = false
        state.loading = false
        state.error = action.payload || '登入失敗'
      })
      .addCase(socialLoginMember.pending, (state) => {
        state.loading = true
        state.error = null
        state.sessionError = null
      })
      .addCase(socialLoginMember.fulfilled, (state, action) => {
        applySession(state, action.payload)
      })
      .addCase(socialLoginMember.rejected, (state, action) => {
        state.authStatus = 'guest'
        state.isAuthenticated = false
        state.loading = false
        state.error = action.payload || '第三方登入失敗'
      })
      .addCase(registerSocialMember.pending, (state) => {
        state.loading = true
        state.error = null
      })
      .addCase(registerSocialMember.fulfilled, (state, action) => {
        applySession(state, action.payload)
      })
      .addCase(registerSocialMember.rejected, (state, action) => {
        state.loading = false
        state.error = action.payload || '第三方註冊失敗'
      })
      .addCase(registerMember.pending, (state) => {
        state.loading = true
        state.error = null
        state.sessionError = null
      })
      .addCase(registerMember.fulfilled, (state, action) => {
        applySession(state, action.payload)
      })
      .addCase(registerMember.rejected, (state, action) => {
        state.authStatus = 'guest'
        state.isAuthenticated = false
        state.loading = false
        state.error = action.payload || '註冊失敗'
      })
      .addCase(fetchProfile.pending, (state) => {
        state.profileLoading = true
        state.authStatus = 'checking'
        state.sessionError = null
      })
      .addCase(fetchProfile.fulfilled, (state, action) => {
        state.player = action.payload
        state.authStatus = 'authenticated'
        state.isAuthenticated = true
        state.profileLoading = false
        state.sessionError = null
      })
      .addCase(fetchProfile.rejected, (state, action) => {
        const message = action.payload || '登入狀態已失效，請重新登入'
        clearSessionState(state)
        state.sessionError = message
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
        clearSessionState(state)
        state.sessionError = null
      })
      .addCase(logoutMember.rejected, (state) => {
        clearSessionState(state)
        state.sessionError = null
      })
  },
})

export const { loginSuccess, logout, tokenRefreshed, setPlayer, clearAuthError } = authSlice.actions
export default authSlice.reducer
