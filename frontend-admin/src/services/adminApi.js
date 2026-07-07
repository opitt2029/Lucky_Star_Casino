import api from './api'

// 從 axios error 萃取可顯示的錯誤訊息。
// admin-service 回應是裸 DTO / ProblemDetail，沒有玩家端的 { code, message, data } envelope。
export function extractError(error) {
  const res = error.response
  if (!res) return '無法連線到伺服器'
  if (res.status === 401) return '帳號或密碼錯誤'
  if (res.status === 403) return '權限不足（此操作僅限 SUPER_ADMIN）'
  return res.data?.message || res.data?.detail || `請求失敗（HTTP ${res.status}）`
}

export const adminApi = {
  // ─── T-050 認證 ───
  // 回應：{ accessToken, tokenType, expiresInMs, username, role }
  async login({ username, password }) {
    const res = await api.post('/admin/auth/login', { username, password })
    return res.data
  },

  // ─── T-051 玩家管理 ───
  // 回應：Spring Data Page（content / totalElements / totalPages / number）
  async listPlayers({ page = 0, size = 20, keyword } = {}) {
    const res = await api.get('/admin/players', { params: { page, size, keyword } })
    return res.data
  },

  async getPlayer(playerId) {
    const res = await api.get(`/admin/players/${playerId}`)
    return res.data
  },

  // 停用會寫 Redis 封鎖標記，由 gateway 即時強制（T-108）
  async setPlayerStatus(playerId, enabled) {
    const res = await api.patch(`/admin/players/${playerId}/status`, { enabled })
    return res.data
  },

  // ─── T-052 星幣流通量報表 ───
  // dimension: day | week | month；from/to: 'YYYY-MM-DD'（必填）
  async getCoinFlowReport({ dimension = 'day', from, to }) {
    const res = await api.get('/admin/reports/coin-flow', { params: { dimension, from, to } })
    return res.data
  },

  // ─── T-053 RTP 監控 ───
  // game 可不帶（查全部）；偏差 >5% 後端標 ABNORMAL
  async getRtpReport({ game, from, to }) {
    const res = await api.get('/admin/reports/rtp', { params: { game, from, to } })
    return res.data
  },

  // ─── T-054 異常告警 ───
  // alertType: BIG_WIN | HIGH_FREQUENCY | ABNORMAL_TRANSFER；resolved: true/false（不帶 = 全部）
  async listAlerts({ page = 0, size = 20, alertType, resolved } = {}) {
    const res = await api.get('/admin/alerts', { params: { page, size, alertType, resolved } })
    return res.data
  },

  // 標記已處理（後端冪等，重複標記不報錯）
  async resolveAlert(alertId) {
    const res = await api.patch(`/admin/alerts/${alertId}/resolve`)
    return res.data
  },

  // ─── T-055 GM 發幣（僅 SUPER_ADMIN，OPERATOR 呼叫會 403）───
  async gmGrant(payload) {
    const res = await api.post('/admin/gm/grant', payload)
    return res.data
  },

  // ─── T-105/T-106 鑽石點數卡 ───
  async generateDiamondCards({ count, faceValue }) {
    const res = await api.post('/admin/diamond/cards', { count, faceValue })
    return res.data
  },

  // status: all | redeemed | unredeemed
  async listDiamondCards({ page = 0, size = 20, status = 'all' } = {}) {
    const res = await api.get('/admin/diamond/cards', { params: { page, size, status } })
    return res.data
  },

  // ─── 禮品商城目錄（ADR-006）───
  async listShopItems({ page = 0, size = 20 } = {}) {
    const res = await api.get('/admin/shop/items', { params: { page, size } })
    return res.data
  },

  async createShopItem(payload) {
    const res = await api.post('/admin/shop/items', payload)
    return res.data
  },

  async updateShopItem(id, payload) {
    const res = await api.put(`/admin/shop/items/${id}`, payload)
    return res.data
  },
}
