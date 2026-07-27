import axios from 'axios'
import store from '../store'
import { logout, tokenRefreshed } from '../store/slices/authSlice'

const useMockApi = import.meta.env.VITE_USE_MOCK_API !== 'false'

const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || '',
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
  },
})

function forceLogout() {
  store.dispatch(logout())
  window.location.href = '/login'
}

// single-flight：多個請求同時 401 時共用同一次續期。
// 後端 refresh 會輪替 refresh token，重複呼叫第二個會 mismatch，故必須序列化。
let refreshPromise = null

// 用「乾淨」的 axios（非 api 實例）呼叫 refresh：避免被本攔截器遞迴攔截，
// 也避免請求攔截器掛上已過期的 access token。
async function refreshAccessToken() {
  const refreshToken = store.getState().auth.refreshToken
  if (!refreshToken) throw new Error('No refresh token')
  const res = await axios.post(
    `${api.defaults.baseURL || ''}/api/v1/auth/refresh`,
    { refreshToken },
    { headers: { 'Content-Type': 'application/json' }, timeout: 10000 },
  )
  const data = res.data.data
  store.dispatch(
    tokenRefreshed({
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
      expiresIn: data.expiresIn,
    }),
  )
  return data.accessToken
}

// Attach JWT access token to every request
api.interceptors.request.use(
  (config) => {
    const token = store.getState().auth.accessToken
    const explicitAuthorization =
      config.headers?.Authorization || config.headers?.get?.('Authorization')
    if (token && !explicitAuthorization) {
      config.headers.Authorization = `Bearer ${token}`
    }
    return config
  },
  (error) => Promise.reject(error)
)

// Handle 401 globally — 先嘗試用 refresh token 靜默續期並重送原請求，續期失敗才登出重導。
// 例外：登入/註冊等 auth 端點本來就可能回 401（帳密錯誤），以及登入流程中「剛簽出 token 後抓 profile」
// 的請求（帶 skipAuthRedirect），這些都交給呼叫端自行處理錯誤，不可整頁重導，否則會把錯誤訊息/表單狀態洗掉。
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const config = error.config || {}
    const url = config.url || ''
    const isAuthEndpoint = url.includes('/api/v1/auth/')
    const status = error.response?.status

    if (status !== 401 || config.skipAuthRedirect || isAuthEndpoint || config._retry) {
      return Promise.reject(error)
    }

    // mock 模式無真實後端可續期；無 refresh token 也無從續期 → 維持原本登出行為。
    if (useMockApi || !store.getState().auth.refreshToken) {
      forceLogout()
      return Promise.reject(error)
    }

    config._retry = true
    try {
      refreshPromise =
        refreshPromise ||
        refreshAccessToken().finally(() => {
          refreshPromise = null
        })
      const newToken = await refreshPromise
      // 重送原請求（請求攔截器會自動帶上 store 內的新 token；此處再顯式覆寫一次以策安全）
      config.headers = config.headers || {}
      config.headers.Authorization = `Bearer ${newToken}`
      return api(config)
    } catch (refreshError) {
      forceLogout()
      return Promise.reject(refreshError)
    }
  }
)

export default api
