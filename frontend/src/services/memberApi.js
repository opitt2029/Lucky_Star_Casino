import api from './api'
import { mockApi } from './mockApi'

const useMockApi = import.meta.env.VITE_USE_MOCK_API !== 'false'

// 登入流程的逾時放寬：後端冷啟動（DB 連線池/gateway 暖機）首次請求可能超過預設 10s。
const AUTH_TIMEOUT_MS = 15000

// 暫時性失敗：無回應（網路斷線/逾時）或 5xx，這類重試是安全的（非業務性錯誤）。
const isTransient = (error) =>
  !error.response || error.code === 'ECONNABORTED' || error.response.status >= 500

// 以小幅退避重試：fn 失敗且 retryOn(err) 為真時重試，最多 retries 次。
async function withRetry(fn, { retries = 2, delayMs = 500, retryOn } = {}) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await fn()
    } catch (error) {
      if (attempt >= retries || (retryOn && !retryOn(error))) throw error
      await new Promise((resolve) => setTimeout(resolve, delayMs * (attempt + 1)))
    }
  }
}

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

const friendlyErrorMap = {
  'Network Error': '連線失敗，請稍後再試',
  'Invalid username or password': '帳號或密碼不正確',
  'Account is disabled': '此帳號已被停用',
}

// 從 axios 錯誤中取出後端回傳的錯誤訊息，並轉成使用者看得懂的說法
function extractError(error) {
  if (error.code === 'ECONNABORTED') return '連線逾時，請再試一次'
  const message = error.response?.data?.message || error.message
  return friendlyErrorMap[message] || message
}

export const memberApi = {
  // POST /api/v1/auth/login → 拿到 token 後再抓一次 profile
  async login({ username, password }) {
    if (useMockApi) {
      return mockApi.login({ username, password })
    }

    // 登入 POST：只重試暫時性失敗（冷啟動逾時/5xx）；401=帳密錯誤不可重試。
    const res = await withRetry(
      () => api.post('/api/v1/auth/login', { username, password }, { timeout: AUTH_TIMEOUT_MS }),
      { retryOn: isTransient },
    )
    const { accessToken, refreshToken, expiresIn } = res.data.data

    // 此時 Redux store 尚未更新，直接帶 token 取得 profile。
    // 額外容忍剛簽出 token 後 gateway 暖機的暫時 401；並帶 skipAuthRedirect 避免全域攔截器整頁重導。
    const profileRes = await withRetry(
      () =>
        api.get('/api/v1/player/profile', {
          timeout: AUTH_TIMEOUT_MS,
          skipAuthRedirect: true,
          headers: { Authorization: `Bearer ${accessToken}` },
        }),
      { retryOn: (error) => isTransient(error) || error.response?.status === 401 },
    )
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

  // GET /api/v1/friends → 目前玩家「已接受」的好友清單（後端只回 ACCEPTED 雙向關係）
  // 回傳已標準化為前端顯示用形狀；無好友時回空陣列。
  async listFriends() {
    if (useMockApi) {
      const friends = await mockApi.getFriends()
      return (friends || []).map((f) => ({
        friendshipId: f.friendshipId ?? f.id,
        friendId: f.id ?? f.friendId,
        name: f.nickname || f.username || `玩家${f.id ?? ''}`,
        username: f.username || '',
        avatarUrl: f.avatarUrl || '',
        friendSince: f.friendSince || null,
      }))
    }

    const res = await api.get('/api/v1/friends')
    const list = res.data.data || []
    return list.map((f) => ({
      friendshipId: f.friendshipId,
      friendId: f.friendId,
      name: f.friendNickname || f.friendUsername || `玩家${f.friendId}`,
      username: f.friendUsername || '',
      avatarUrl: f.friendAvatarUrl || '',
      friendSince: f.friendSince || null,
    }))
  },

  // GET /api/v1/friends/requests → 收到、尚未處理的好友邀請。
  async listFriendRequests() {
    if (useMockApi) {
      const requests = await mockApi.getFriendRequests()
      return (requests || []).map((r) => ({
        friendshipId: r.friendshipId ?? r.id,
        requesterId: r.requesterId,
        name: r.requesterNickname || r.requesterUsername || `玩家${r.requesterId ?? ''}`,
        username: r.requesterUsername || '',
        avatarUrl: r.requesterAvatarUrl || '',
        requestedAt: r.requestedAt || r.createdAt || null,
      }))
    }

    const res = await api.get('/api/v1/friends/requests')
    const list = res.data.data || []
    return list.map((r) => ({
      friendshipId: r.friendshipId,
      requesterId: r.requesterId,
      name: r.requesterNickname || r.requesterUsername || `玩家${r.requesterId}`,
      username: r.requesterUsername || '',
      avatarUrl: r.requesterAvatarUrl || '',
      requestedAt: r.requestedAt || null,
    }))
  },

  // POST /api/v1/friends/request → 以玩家 ID 送出好友邀請。
  async sendFriendRequest(receiverId) {
    if (useMockApi) {
      return mockApi.sendFriendRequest(receiverId)
    }
    const res = await api.post('/api/v1/friends/request', { receiverId: Number(receiverId) })
    return res.data.data
  },

  // PUT /api/v1/friends/{friendshipId}/accept → 接受好友邀請。
  async acceptFriendRequest(friendshipId) {
    if (useMockApi) {
      return mockApi.acceptFriendRequest(friendshipId)
    }
    const res = await api.put(`/api/v1/friends/${friendshipId}/accept`)
    return res.data.data
  },

  // PUT /api/v1/friends/{friendshipId}/reject → 拒絕好友邀請。
  async rejectFriendRequest(friendshipId) {
    if (useMockApi) {
      return mockApi.rejectFriendRequest(friendshipId)
    }
    const res = await api.put(`/api/v1/friends/${friendshipId}/reject`)
    return res.data.data
  },

  // DELETE /api/v1/friends/{friendshipId} → 解除好友關係
  async deleteFriend(friendshipId) {
    if (useMockApi) {
      return mockApi.removeFriend?.(friendshipId)
    }
    await api.delete(`/api/v1/friends/${friendshipId}`)
  },
}

export { extractError }
