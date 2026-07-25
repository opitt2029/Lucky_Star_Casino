import api from './api'
import { mockApi } from './mockApi'

const useMockApi = import.meta.env.VITE_USE_MOCK_API !== 'false'
const AUTH_TIMEOUT_MS = 15000

const isTransient = (error) =>
  !error.response || error.code === 'ECONNABORTED' || error.response.status >= 500

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

function mapProfile(data) {
  return {
    id: String(data.playerId),
    username: data.username,
    nickname: data.nickname,
    avatarUrl: data.avatar || '',
    role: data.role,
    createdAt: data.createdAt,
    consecutiveCheckInDays: 0,
    lastCheckInDate: null,
  }
}

function gatewayUrl(path) {
  if (!path || /^https?:\/\//i.test(path)) return path
  const baseUrl = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/+$/, '')
  return `${baseUrl}${path.startsWith('/') ? path : `/${path}`}`
}

const friendlyErrorMap = {
  'Network Error': '連線失敗，請稍後再試',
  'Invalid username or password': '帳號或密碼錯誤',
  'Account is disabled': '帳號已停用',
}

function extractError(error) {
  if (error.code === 'ECONNABORTED') return '連線逾時，請再試一次'
  const message = error.response?.data?.message || error.message
  return friendlyErrorMap[message] || message
}

function normalizeFriend(friend) {
  return {
    friendshipId: friend.friendshipId ?? friend.id,
    friendId: friend.friendId ?? friend.id,
    name:
      friend.friendNickname ||
      friend.friendUsername ||
      friend.nickname ||
      friend.username ||
      `玩家${friend.friendId ?? friend.id ?? ''}`,
    username: friend.friendUsername || friend.username || '',
    avatarUrl: friend.friendAvatarUrl || friend.avatarUrl || '',
    friendSince: friend.friendSince || null,
  }
}

function normalizeFriendRequest(request) {
  return {
    friendshipId: request.friendshipId ?? request.id,
    requesterId: request.requesterId,
    name:
      request.requesterNickname ||
      request.requesterUsername ||
      `玩家${request.requesterId ?? ''}`,
    username: request.requesterUsername || '',
    avatarUrl: request.requesterAvatarUrl || '',
    requestedAt: request.requestedAt || request.createdAt || null,
  }
}

export const memberApi = {
  async login({ username, password }) {
    if (useMockApi) {
      return mockApi.login({ username, password })
    }

    const res = await withRetry(
      () => api.post('/api/v1/auth/login', { username, password }, { timeout: AUTH_TIMEOUT_MS }),
      { retryOn: isTransient },
    )
    const { accessToken, refreshToken, expiresIn } = res.data.data

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

  async startSocialLogin(provider) {
    if (useMockApi) {
      return mockApi.startSocialLogin(provider)
    }
    const res = await api.post(`/api/v1/auth/social/${provider}/start`)
    return {
      ...res.data.data,
      authorizationUrl: gatewayUrl(res.data.data.authorizationUrl),
    }
  },

  async exchangeSocialLogin(ticket) {
    if (useMockApi) {
      return mockApi.exchangeSocialLogin(ticket)
    }
    const res = await api.post('/api/v1/auth/social/exchange', { ticket })
    const { accessToken, refreshToken, expiresIn } = res.data.data
    const profileRes = await api.get('/api/v1/player/profile', {
      skipAuthRedirect: true,
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    return {
      accessToken,
      refreshToken,
      expiresIn,
      player: mapProfile(profileRes.data.data),
    }
  },

  async register({ username, email, password, nickname }) {
    if (useMockApi) {
      return mockApi.register({ username, email, password, nickname })
    }

    await api.post('/api/v1/auth/register', { username, email, password, nickname })
    return memberApi.login({ username, password })
  },

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

  async getProfile() {
    if (useMockApi) {
      return mockApi.getProfile()
    }

    const res = await api.get('/api/v1/player/profile')
    return mapProfile(res.data.data)
  },

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

  async getSocialBindings() {
    if (useMockApi) {
      return mockApi.getSocialBindings()
    }
    const res = await api.get('/api/v1/player/social-bindings')
    return res.data.data || []
  },

  async startSocialBinding(provider) {
    if (useMockApi) {
      return mockApi.startSocialBinding(provider)
    }
    const res = await api.post(`/api/v1/player/social-bindings/${provider}/start`)
    return {
      ...res.data.data,
      authorizationUrl: gatewayUrl(res.data.data.authorizationUrl),
    }
  },

  async removeSocialBinding(provider) {
    if (useMockApi) {
      return mockApi.removeSocialBinding(provider)
    }
    const res = await api.delete(`/api/v1/player/social-bindings/${provider}`)
    return res.data.data
  },

  async listFriends() {
    if (useMockApi) {
      const friends = await mockApi.getFriends()
      return (friends || []).map(normalizeFriend)
    }

    const res = await api.get('/api/v1/friends')
    return (res.data.data || []).map(normalizeFriend)
  },

  async listFriendRequests() {
    if (useMockApi) {
      const requests = await mockApi.getFriendRequests()
      return (requests || []).map(normalizeFriendRequest)
    }

    const res = await api.get('/api/v1/friends/requests')
    return (res.data.data || []).map(normalizeFriendRequest)
  },

  async sendFriendRequest(receiverId) {
    if (useMockApi) {
      return mockApi.sendFriendRequest(receiverId)
    }
    const res = await api.post('/api/v1/friends/request', { receiverId: Number(receiverId) })
    return res.data.data
  },

  async acceptFriendRequest(friendshipId) {
    if (useMockApi) {
      return mockApi.acceptFriendRequest(friendshipId)
    }
    const res = await api.put(`/api/v1/friends/${friendshipId}/accept`)
    return res.data.data
  },

  async rejectFriendRequest(friendshipId) {
    if (useMockApi) {
      return mockApi.rejectFriendRequest(friendshipId)
    }
    const res = await api.put(`/api/v1/friends/${friendshipId}/reject`)
    return res.data.data
  },

  async deleteFriend(friendshipId) {
    if (useMockApi) {
      return mockApi.removeFriend?.(friendshipId)
    }
    await api.delete(`/api/v1/friends/${friendshipId}`)
  },
}

export { extractError }
