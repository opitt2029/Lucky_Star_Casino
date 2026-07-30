import { beforeEach, describe, expect, it } from 'vitest'
import reducer, { fetchProfile, loginSuccess, logoutMember } from './authSlice'

describe('authSlice bootstrap state', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('marks a restored session as authenticated after profile validation', () => {
    const initial = reducer(undefined, { type: '@@init' })
    const withSession = reducer(
      initial,
      loginSuccess({ accessToken: 'access', refreshToken: 'refresh', player: { id: '1' } }),
    )
    const checking = reducer(withSession, fetchProfile.pending('request-id'))
    const authenticated = reducer(
      checking,
      fetchProfile.fulfilled({ id: '1', nickname: 'Player' }, 'request-id'),
    )

    expect(authenticated.authStatus).toBe('authenticated')
    expect(authenticated.isAuthenticated).toBe(true)
    expect(authenticated.player.nickname).toBe('Player')
  })

  it('keeps authenticated pages mounted while refreshing an existing profile', () => {
    const authenticated = reducer(
      reducer(undefined, { type: '@@init' }),
      loginSuccess({ accessToken: 'access', refreshToken: 'refresh', player: { id: '1', nickname: 'Player' } }),
    )

    const refreshing = reducer(authenticated, fetchProfile.pending('request-id'))

    expect(refreshing.authStatus).toBe('authenticated')
    expect(refreshing.isAuthenticated).toBe(true)
    expect(refreshing.profileLoading).toBe(true)
    expect(refreshing.player.nickname).toBe('Player')
  })
  it('clears tokens when restored profile validation fails', () => {
    localStorage.setItem('accessToken', 'expired')
    localStorage.setItem('refreshToken', 'expired-refresh')
    const initial = {
      ...reducer(undefined, { type: '@@init' }),
      accessToken: 'expired',
      refreshToken: 'expired-refresh',
      authStatus: 'checking',
    }
    const state = reducer(
      initial,
      fetchProfile.rejected(null, 'request-id', undefined, '登入狀態已失效'),
    )

    expect(state.authStatus).toBe('guest')
    expect(state.isAuthenticated).toBe(false)
    expect(state.accessToken).toBeNull()
    expect(localStorage.getItem('accessToken')).toBeNull()
  })

  it('clears local state even when logout request fails', () => {
    const initial = reducer(
      reducer(undefined, { type: '@@init' }),
      loginSuccess({ accessToken: 'access', refreshToken: 'refresh', player: { id: '1' } }),
    )
    const state = reducer(initial, logoutMember.rejected(new Error('offline'), 'request-id'))

    expect(state.authStatus).toBe('guest')
    expect(state.player).toBeNull()
  })
})
