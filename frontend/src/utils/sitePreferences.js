import { useCallback, useEffect, useState } from 'react'

const SITE_PREFERENCES_KEY = 'lucky-star-site-preferences-v1'

const defaultSitePreferences = {
  announcementsEnabled: true,
  backgroundEffectsEnabled: true,
}

const listeners = new Set()

function normalizePreferences(value) {
  return {
    ...defaultSitePreferences,
    ...(value && typeof value === 'object' ? value : {}),
  }
}

export function readSitePreferences() {
  try {
    return normalizePreferences(JSON.parse(localStorage.getItem(SITE_PREFERENCES_KEY)))
  } catch {
    return { ...defaultSitePreferences }
  }
}

export function updateSitePreferences(patch) {
  const next = normalizePreferences({ ...readSitePreferences(), ...patch })
  try {
    localStorage.setItem(SITE_PREFERENCES_KEY, JSON.stringify(next))
  } catch {
    // Browsers can reject localStorage in private or restricted contexts.
  }
  listeners.forEach((listener) => listener(next))
  return next
}

export function subscribeSitePreferences(listener) {
  listeners.add(listener)

  const handleStorage = (event) => {
    if (event.key === SITE_PREFERENCES_KEY) {
      listener(readSitePreferences())
    }
  }

  window.addEventListener('storage', handleStorage)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', handleStorage)
  }
}

export function useSitePreferences() {
  const [preferences, setPreferences] = useState(readSitePreferences)

  useEffect(() => subscribeSitePreferences(setPreferences), [])

  const updatePreferences = useCallback((patch) => updateSitePreferences(patch), [])

  return [preferences, updatePreferences]
}
