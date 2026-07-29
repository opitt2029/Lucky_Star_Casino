export const OAUTH_RETURN_TO_KEY = 'lucky-star-oauth-return-to-v1'

export function normalizeInternalPath(path, fallback = '/games') {
  if (typeof path !== 'string') return fallback
  const value = path.trim()
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/auth/callback')) {
    return fallback
  }
  return value
}

export function pathFromLocationState(from, fallback = '/games') {
  if (!from || typeof from !== 'object') return fallback
  const path = `${from.pathname || ''}${from.search || ''}${from.hash || ''}`
  return normalizeInternalPath(path, fallback)
}

export function saveOAuthReturnTo(path) {
  try {
    sessionStorage.setItem(OAUTH_RETURN_TO_KEY, normalizeInternalPath(path))
  } catch {
    // sessionStorage unavailable: callback will use the default destination.
  }
}

export function consumeOAuthReturnTo(fallback = '/games') {
  try {
    const stored = sessionStorage.getItem(OAUTH_RETURN_TO_KEY)
    sessionStorage.removeItem(OAUTH_RETURN_TO_KEY)
    return normalizeInternalPath(stored, fallback)
  } catch {
    return fallback
  }
}
