import api from './api'

const useMockApi = import.meta.env.VITE_USE_MOCK_API === 'true'

function dataOf(payload) {
  return payload && typeof payload === 'object' && 'data' in payload ? payload.data : payload
}

function elapsedSince(startedAt) {
  return Math.round(Date.now() - startedAt)
}

function summarizeValue(value) {
  if (value === null || value === undefined) return '-'
  if (typeof value === 'string') return value.length > 120 ? `${value.slice(0, 117)}...` : value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return `${value.length} rows`
  return JSON.stringify(value).slice(0, 160)
}

function errorMessage(error) {
  return (
    error?.response?.data?.message ||
    error?.response?.data?.error ||
    error?.message ||
    'Unknown error'
  )
}

async function probe({ id, service, name, method = 'get', path, body, params, expect, detail }) {
  const startedAt = Date.now()
  try {
    const response = await api.request({ method, url: path, data: body, params })
    const payload = dataOf(response.data)
    const ok = expect ? expect({ response, payload }) : response.status >= 200 && response.status < 300
    return {
      id,
      service,
      name,
      method: method.toUpperCase(),
      path,
      status: ok ? 'PASS' : 'FAIL',
      httpStatus: response.status,
      durationMs: elapsedSince(startedAt),
      detail: detail ? detail({ response, payload }) : summarizeValue(payload),
    }
  } catch (error) {
    return {
      id,
      service,
      name,
      method: method.toUpperCase(),
      path,
      status: 'FAIL',
      httpStatus: error?.response?.status ?? 0,
      durationMs: elapsedSince(startedAt),
      detail: errorMessage(error),
    }
  }
}

const safeProbes = [
  {
    id: 'gateway-health',
    service: 'gateway',
    name: 'Gateway health',
    path: '/actuator/health',
    expect: ({ payload }) => payload?.status === 'UP',
    detail: ({ payload }) => `status=${payload?.status ?? '-'}`,
  },
  {
    id: 'member-openapi',
    service: 'member',
    name: 'member-service route',
    path: '/v3/api-docs/member',
    expect: ({ response, payload }) => response.status === 200 && Boolean(payload?.openapi),
    detail: ({ payload }) => payload?.info?.title || 'OpenAPI reachable',
  },
  {
    id: 'wallet-openapi',
    service: 'wallet',
    name: 'wallet-service route',
    path: '/v3/api-docs/wallet',
    expect: ({ response, payload }) => response.status === 200 && Boolean(payload?.openapi),
    detail: ({ payload }) => payload?.info?.title || 'OpenAPI reachable',
  },
  {
    id: 'game-openapi',
    service: 'game',
    name: 'game-service route',
    path: '/v3/api-docs/game',
    expect: ({ response, payload }) => response.status === 200 && Boolean(payload?.openapi),
    detail: ({ payload }) => payload?.info?.title || 'OpenAPI reachable',
  },
  {
    id: 'rank-openapi',
    service: 'rank',
    name: 'rank-service route',
    path: '/v3/api-docs/rank',
    expect: ({ response, payload }) => response.status === 200 && Boolean(payload?.openapi),
    detail: ({ payload }) => payload?.info?.title || 'OpenAPI reachable',
  },
  {
    id: 'profile',
    service: 'member',
    name: 'JWT profile',
    path: '/api/v1/player/profile',
    expect: ({ response, payload }) => response.status === 200 && Boolean(payload?.playerId),
    detail: ({ payload }) => `${payload?.username ?? '-'} (#${payload?.playerId ?? '-'})`,
  },
  {
    id: 'wallet-balance',
    service: 'wallet',
    name: 'Wallet balance',
    path: '/api/v1/wallet/balance',
    expect: ({ response, payload }) => response.status === 200 && payload?.balance !== undefined,
    detail: ({ payload }) => `balance=${Number(payload?.balance ?? 0).toLocaleString()}`,
  },
  {
    id: 'wallet-transactions',
    service: 'wallet',
    name: 'Wallet transactions',
    path: '/api/v1/wallet/transactions',
    params: { page: 0, size: 5 },
    expect: ({ response, payload }) => response.status === 200 && Array.isArray(payload?.content),
    detail: ({ payload }) => `rows=${payload?.content?.length ?? 0}, total=${payload?.totalElements ?? 0}`,
  },
  {
    id: 'diamond-balance',
    service: 'wallet',
    name: 'Diamond balance',
    path: '/api/v1/wallet/diamond/balance',
    expect: ({ response, payload }) => response.status === 200 && payload?.balance !== undefined,
    detail: ({ payload }) => `diamonds=${Number(payload?.balance ?? 0).toLocaleString()}`,
  },
  {
    id: 'game-history',
    service: 'game',
    name: 'Game history',
    path: '/api/v1/game/history',
    params: { page: 1, pageSize: 5 },
    expect: ({ response, payload }) => response.status === 200 && Array.isArray(payload?.items),
    detail: ({ payload }) => `rows=${payload?.items?.length ?? 0}, total=${payload?.total ?? 0}`,
  },
  {
    id: 'rank-global',
    service: 'rank',
    name: 'Global rank',
    path: '/api/v1/rank/global',
    expect: ({ response, payload }) => response.status === 200 && Array.isArray(payload),
    detail: ({ payload }) => `entries=${payload?.length ?? 0}`,
  },
  {
    id: 'rank-friends',
    service: 'rank',
    name: 'Friend rank',
    path: '/api/v1/rank/friends',
    expect: ({ response, payload }) => response.status === 200 && Array.isArray(payload),
    detail: ({ payload }) => `entries=${payload?.length ?? 0}`,
  },
]

export const integrationTestApi = {
  modeLabel: useMockApi ? 'Mock API' : 'Real API',

  async runSafeProbes() {
    const results = []
    for (const item of safeProbes) {
      results.push(await probe(item))
    }
    return results
  },

  async claimBankruptcyAid() {
    return probe({
      id: `bankruptcy-aid-${Date.now()}`,
      service: 'wallet',
      name: 'Claim bankruptcy aid',
      method: 'post',
      path: '/api/v1/wallet/bankruptcy-aid',
      expect: ({ response }) => response.status === 200,
      detail: ({ payload }) =>
        `amount=${Number(payload?.amount ?? 0).toLocaleString()}, after=${Number(payload?.balanceAfter ?? 0).toLocaleString()}`,
    })
  },

  async spinSlot({ bet = 100 } = {}) {
    return probe({
      id: `slot-spin-${Date.now()}`,
      service: 'game',
      name: `Slot spin ${bet}`,
      method: 'post',
      path: '/api/v1/game/slot/spin',
      body: { bet, clientSeed: `ui-integration-${Date.now()}` },
      expect: ({ response, payload }) => response.status === 200 && Boolean(payload?.roundId),
      detail: ({ payload }) =>
        `round=${payload?.roundId ?? '-'}, payout=${Number(payload?.payout ?? 0).toLocaleString()}, balance=${Number(payload?.wallet?.balance ?? 0).toLocaleString()}`,
    })
  },
}
