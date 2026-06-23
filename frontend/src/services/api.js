import axios from 'axios'
import store from '../store'
import { logout } from '../store/slices/authSlice'

const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || '',
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
  },
})

// Attach JWT access token to every request
api.interceptors.request.use(
  (config) => {
    const token = store.getState().auth.accessToken
    if (token) {
      config.headers.Authorization = `Bearer ${token}`
    }
    return config
  },
  (error) => Promise.reject(error)
)

// Handle 401 globally — clear auth state and redirect to login.
// 例外：登入/註冊等 auth 端點本來就可能回 401（帳密錯誤），以及登入流程中「剛簽出 token 後抓 profile」
// 的請求（帶 skipAuthRedirect），這些都交給呼叫端自行處理錯誤，不可整頁重導，否則會把錯誤訊息/表單狀態洗掉。
api.interceptors.response.use(
  (response) => response,
  (error) => {
    const config = error.config || {}
    const url = config.url || ''
    const isAuthEndpoint = url.includes('/api/v1/auth/')
    if (error.response?.status === 401 && !config.skipAuthRedirect && !isAuthEndpoint) {
      store.dispatch(logout())
      window.location.href = '/login'
    }
    return Promise.reject(error)
  }
)

export default api
