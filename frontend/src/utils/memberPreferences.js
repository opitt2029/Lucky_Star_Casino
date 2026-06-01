export const socialProviders = [
  {
    id: 'line',
    label: 'LINE',
    accentClass: 'border-emerald-300/40 bg-emerald-500/10 text-emerald-100',
  },
  { id: 'google', label: 'Google', accentClass: 'border-sky-300/40 bg-sky-500/10 text-sky-100' },
  { id: 'apple', label: 'Apple', accentClass: 'border-zinc-200/40 bg-zinc-200/10 text-zinc-100' },
]

const SOCIAL_BINDINGS_KEY = 'lucky-star-social-bindings-v1'

function readJson(key, fallback) {
  try {
    const value = localStorage.getItem(key)
    return value ? JSON.parse(value) : fallback
  } catch {
    return fallback
  }
}

function writeJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value))
}

export function getBirthDateMax(today = new Date()) {
  const max = new Date(today)
  max.setFullYear(max.getFullYear() - 18)
  return max.toISOString().slice(0, 10)
}

export function isAdultBirthDate(value, today = new Date()) {
  if (!value) return false
  const birthDate = new Date(`${value}T00:00:00`)
  if (Number.isNaN(birthDate.getTime())) return false
  const adultDate = new Date(birthDate)
  adultDate.setFullYear(adultDate.getFullYear() + 18)
  return adultDate <= today
}

export function getSocialBindings(playerId) {
  const bindings = readJson(SOCIAL_BINDINGS_KEY, {})
  const playerBindings = bindings[playerId] || {}
  return socialProviders.reduce((result, provider) => {
    result[provider.id] = Boolean(playerBindings[provider.id])
    return result
  }, {})
}

export function setSocialBinding(playerId, providerId, bound) {
  const bindings = readJson(SOCIAL_BINDINGS_KEY, {})
  const playerBindings = { ...(bindings[playerId] || {}), [providerId]: bound }
  const nextBindings = { ...bindings, [playerId]: playerBindings }
  writeJson(SOCIAL_BINDINGS_KEY, nextBindings)
  return getSocialBindings(playerId)
}
