import axios from 'axios'
import store from '../store'
import { logout } from '../store/slices/adminAuthSlice'

const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || '',
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
  },
})

// 每個請求掛上 ADMIN JWT（與玩家端 JWT 是兩套獨立 secret，不可混用）
api.interceptors.request.use(
  (config) => {
    const token = store.getState().adminAuth.accessToken
    if (token) {
      config.headers.Authorization = `Bearer ${token}`
    }
    return config
  },
  (error) => Promise.reject(error)
)

// admin JWT 沒有 refresh token 機制（LoginResponse 只回 accessToken），
// 故 401 一律登出重導，不做玩家端那套 single-flight 靜默續期。
// 例外：登入端點本身的 401 = 帳密錯誤，交給表單顯示錯誤訊息，不可整頁重導。
api.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error.response?.status
    const url = error.config?.url || ''
    const isLoginEndpoint = url.includes('/admin/auth/')
    if (status === 401 && !isLoginEndpoint) {
      store.dispatch(logout())
      window.location.href = '/login'
    }
    return Promise.reject(error)
  }
)

export default api
