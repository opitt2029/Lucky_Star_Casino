import { beforeEach, describe, expect, it } from 'vitest'
import {
  consumeOAuthReturnTo,
  normalizeInternalPath,
  pathFromLocationState,
  saveOAuthReturnTo,
} from './authNavigation'

describe('authNavigation', () => {
  beforeEach(() => {
    sessionStorage.clear()
  })

  it('accepts only internal return paths', () => {
    expect(normalizeInternalPath('/rank?scope=GLOBAL')).toBe('/rank?scope=GLOBAL')
    expect(normalizeInternalPath('https://example.com')).toBe('/games')
    expect(normalizeInternalPath('//example.com')).toBe('/games')
    expect(normalizeInternalPath('/auth/callback?ticket=secret')).toBe('/games')
  })

  it('builds a return path from router location state', () => {
    expect(
      pathFromLocationState({ pathname: '/records', search: '?type=game', hash: '#latest' }),
    ).toBe('/records?type=game#latest')
  })

  it('stores and consumes the OAuth return path once', () => {
    saveOAuthReturnTo('/profile')
    expect(consumeOAuthReturnTo()).toBe('/profile')
    expect(consumeOAuthReturnTo()).toBe('/games')
  })
})
