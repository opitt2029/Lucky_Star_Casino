import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'

// 共享的 mock：store 與 authSlice action creators。
// 用 vi.hoisted 讓 vi.mock 工廠能引用（vi.mock 會被提升到 import 之前）。
const { mockStore, logoutMock, tokenRefreshedMock } = vi.hoisted(() => {
  const state = { auth: { accessToken: 'access-old', refreshToken: 'refresh-1' } }
  return {
    mockStore: { getState: () => state, dispatch: vi.fn(), _state: state },
    logoutMock: vi.fn(() => ({ type: 'auth/logout' })),
    tokenRefreshedMock: vi.fn((payload) => ({ type: 'auth/tokenRefreshed', payload })),
  }
})

// 隔離待測模組的相依：避免載入真實 store（會牽出 memberApi → mockApi 等整串相依）。
vi.mock('../store', () => ({ default: mockStore }))
vi.mock('../store/slices/authSlice', () => ({ logout: logoutMock, tokenRefreshed: tokenRefreshedMock }))

// 自訂 axios adapter：原始請求回指定狀態碼錯誤；被攔截器重送（帶 _retry）時回 200。
// 這樣不需真實網路即可驅動「401 → 續期 → 重送」整條攔截器流程。
function makeAdapter({ status = 401 } = {}) {
  return (config) => {
    if (config._retry) {
      return Promise.resolve({ data: { retried: true }, status: 200, statusText: 'OK', headers: {}, config })
    }
    const error = new Error(`Request failed with status code ${status}`)
    error.config = config
    error.response = { status, data: {}, config }
    error.isAxiosError = true
    return Promise.reject(error)
  }
}

let api
let axios

beforeEach(async () => {
  vi.resetModules()
  vi.clearAllMocks()
  // useMockApi 在模組載入時由 import.meta.env 決定，需在動態 import 前 stub 成非 mock 模式。
  vi.stubEnv('VITE_USE_MOCK_API', 'false')
  vi.stubEnv('VITE_API_BASE_URL', '')
  mockStore._state.auth = { accessToken: 'access-old', refreshToken: 'refresh-1' }
  // jsdom 的 location.href 預設不可直接觀測導向，換成普通物件以便斷言。
  Object.defineProperty(window, 'location', { configurable: true, writable: true, value: { href: '' } })
  // resetModules 後 api.js 會載入「重置後」的 axios 快取實例；測試也必須取同一份才能 spy 到。
  axios = (await import('axios')).default
  api = (await import('./api.js')).default
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('api 401 攔截器自動續期', () => {
  test('401 → 用 refresh token 續期並重送原請求', async () => {
    api.defaults.adapter = makeAdapter()
    const postSpy = vi.spyOn(axios, 'post').mockResolvedValue({
      data: { data: { accessToken: 'new-access', refreshToken: 'refresh-2', expiresIn: 900 } },
    })

    const res = await api.get('/protected')

    expect(res.data).toEqual({ retried: true })
    expect(postSpy).toHaveBeenCalledTimes(1)
    expect(postSpy.mock.calls[0][0]).toContain('/api/v1/auth/refresh')
    expect(postSpy.mock.calls[0][1]).toEqual({ refreshToken: 'refresh-1' })
    // 必須存回後端輪替後的新 refresh token
    expect(tokenRefreshedMock).toHaveBeenCalledWith({
      accessToken: 'new-access',
      refreshToken: 'refresh-2',
      expiresIn: 900,
    })
    expect(logoutMock).not.toHaveBeenCalled()
  })

  test('並發 401 只續期一次（single-flight）', async () => {
    api.defaults.adapter = makeAdapter()
    const postSpy = vi.spyOn(axios, 'post').mockImplementation(
      () =>
        new Promise((resolve) =>
          setTimeout(
            () => resolve({ data: { data: { accessToken: 'na', refreshToken: 'nr', expiresIn: 900 } } }),
            10,
          ),
        ),
    )

    const [r1, r2] = await Promise.all([api.get('/a'), api.get('/b')])

    expect(r1.data).toEqual({ retried: true })
    expect(r2.data).toEqual({ retried: true })
    expect(postSpy).toHaveBeenCalledTimes(1)
  })

  test('續期失敗 → 登出並導向 /login', async () => {
    api.defaults.adapter = makeAdapter()
    vi.spyOn(axios, 'post').mockRejectedValue(
      Object.assign(new Error('refresh expired'), { response: { status: 401 } }),
    )

    await expect(api.get('/protected')).rejects.toBeTruthy()

    expect(logoutMock).toHaveBeenCalledTimes(1)
    expect(window.location.href).toBe('/login')
  })

  test('無 refresh token → 直接登出，不嘗試續期', async () => {
    mockStore._state.auth.refreshToken = null
    api.defaults.adapter = makeAdapter()
    const postSpy = vi.spyOn(axios, 'post')

    await expect(api.get('/protected')).rejects.toBeTruthy()

    expect(postSpy).not.toHaveBeenCalled()
    expect(logoutMock).toHaveBeenCalledTimes(1)
    expect(window.location.href).toBe('/login')
  })

  test('auth 端點 401（帳密錯誤）交給呼叫端，不續期/不重導', async () => {
    api.defaults.adapter = makeAdapter()
    const postSpy = vi.spyOn(axios, 'post')

    await expect(api.post('/api/v1/auth/login')).rejects.toBeTruthy()

    expect(postSpy).not.toHaveBeenCalled()
    expect(logoutMock).not.toHaveBeenCalled()
    expect(window.location.href).toBe('')
  })

  test('skipAuthRedirect 的 401 交給呼叫端，不續期/不重導', async () => {
    api.defaults.adapter = makeAdapter()
    const postSpy = vi.spyOn(axios, 'post')

    await expect(api.get('/protected', { skipAuthRedirect: true })).rejects.toBeTruthy()

    expect(postSpy).not.toHaveBeenCalled()
    expect(logoutMock).not.toHaveBeenCalled()
  })

  test('非 401 錯誤直接拋出，不續期/不重導', async () => {
    api.defaults.adapter = makeAdapter({ status: 500 })
    const postSpy = vi.spyOn(axios, 'post')

    await expect(api.get('/protected')).rejects.toBeTruthy()

    expect(postSpy).not.toHaveBeenCalled()
    expect(logoutMock).not.toHaveBeenCalled()
  })
})
