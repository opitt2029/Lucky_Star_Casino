import { createAsyncThunk, createSlice } from '@reduxjs/toolkit'
import { adminApi, extractError } from '../../services/adminApi'

// localStorage key 加 admin 前綴：與玩家端（accessToken/refreshToken）區隔，
// 未來若後台與玩家站部署在同一網域也不會互相覆寫。
const TOKEN_KEY = 'adminAccessToken'
const USERNAME_KEY = 'adminUsername'
const ROLE_KEY = 'adminRole'

const initialState = {
  // 頁面重整時從 localStorage 還原登入狀態（admin JWT 無 refresh token，過期即重新登入）
  accessToken: localStorage.getItem(TOKEN_KEY) || null,
  username: localStorage.getItem(USERNAME_KEY) || null,
  // SUPER_ADMIN | OPERATOR — 僅供 UI 顯示/隱藏功能用，實際授權以後端 @PreAuthorize 為準
  role: localStorage.getItem(ROLE_KEY) || null,
  isAuthenticated: Boolean(localStorage.getItem(TOKEN_KEY)),
  loading: false,
  error: null,
}

export const loginAdmin = createAsyncThunk('adminAuth/login', async (payload, { rejectWithValue }) => {
  try {
    return await adminApi.login(payload)
  } catch (error) {
    return rejectWithValue(extractError(error))
  }
})

const adminAuthSlice = createSlice({
  name: 'adminAuth',
  initialState,
  reducers: {
    logout(state) {
      state.accessToken = null
      state.username = null
      state.role = null
      state.isAuthenticated = false
      state.loading = false
      state.error = null
      localStorage.removeItem(TOKEN_KEY)
      localStorage.removeItem(USERNAME_KEY)
      localStorage.removeItem(ROLE_KEY)
    },
    clearAuthError(state) {
      state.error = null
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(loginAdmin.pending, (state) => {
        state.loading = true
        state.error = null
      })
      .addCase(loginAdmin.fulfilled, (state, action) => {
        const { accessToken, username, role } = action.payload
        state.accessToken = accessToken
        state.username = username
        state.role = role
        state.isAuthenticated = true
        state.loading = false
        state.error = null
        localStorage.setItem(TOKEN_KEY, accessToken)
        localStorage.setItem(USERNAME_KEY, username)
        localStorage.setItem(ROLE_KEY, role)
      })
      .addCase(loginAdmin.rejected, (state, action) => {
        state.loading = false
        state.error = action.payload || '登入失敗'
      })
  },
})

export const { logout, clearAuthError } = adminAuthSlice.actions
export default adminAuthSlice.reducer
