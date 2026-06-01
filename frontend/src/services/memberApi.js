import api from './api'
import { mockApi } from './mockApi'

const useMockApi = import.meta.env.VITE_USE_MOCK_API !== 'false'

// 將後端 ProfileResponse 的欄位名轉成前端慣用格式
function mapProfile(data) {
  return {
    id: String(data.playerId),
    username: data.username,
    nickname: data.nickname,
    avatarUrl: data.avatar || '',
    role: data.role,
    createdAt: data.createdAt,
    // checkin 功能尚未串接，先給預設值
    consecutiveCheckInDays: 0,
    lastCheckInDate: null,
  }
}

// 從 axios 錯誤中取出後端回傳的錯誤訊息
function extractError(error) {
  return error.response?.data?.message || error.message
}

export const memberApi = {
  // POST /api/v1/auth/login → 拿到 token 後再抓一次 profile
  async login({ username, password }) {
    if (useMockApi) {
      return mockApi.login({ username, password })
    }

    const res = await api.post('/api/v1/auth/login', { username, password })
    const { accessToken, refreshToken, expiresIn } = res.data.data

    // 此時 Redux store 尚未更新，直接帶 token 取得 profile
    const profileRes = await api.get('/api/v1/player/profile', {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    const player = mapProfile(profileRes.data.data)
    return { accessToken, refreshToken, expiresIn, player }
  },

  // POST /api/v1/auth/register → 成功後自動登入取得 token
  async register({ username, email, password, nickname }) {
    if (useMockApi) {
      return mockApi.register({ username, email, password, nickname })
    }

    await api.post('/api/v1/auth/register', { username, email, password, nickname })
    return memberApi.login({ username, password })
  },

  // POST /api/v1/auth/logout
  async logout() {
    if (useMockApi) {
      await mockApi.logout()
      return
    }

    try {
      await api.post('/api/v1/auth/logout')
    } finally {
      localStorage.removeItem('accessToken')
      localStorage.removeItem('refreshToken')
    }
  },

  // GET /api/v1/player/profile
  async getProfile() {
    if (useMockApi) {
      return mockApi.getProfile()
    }

    const res = await api.get('/api/v1/player/profile')
    return mapProfile(res.data.data)
  },

  // PUT /api/v1/player/profile
  async updateProfile({ nickname, avatarUrl }) {
    if (useMockApi) {
      return mockApi.updateProfile({ nickname, avatarUrl })
    }

    const body = {}
    if (nickname !== undefined) body.nickname = nickname
    if (avatarUrl !== undefined) body.avatar = avatarUrl
    const res = await api.put('/api/v1/player/profile', body)
    return mapProfile(res.data.data)
  },
}

export { extractError }
