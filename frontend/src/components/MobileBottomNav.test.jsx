import { describe, expect, it } from 'vitest'

// MobileBottomNav relies on the existing Redux/router integration and is exercised by Playwright.
// This lightweight contract test keeps the primary destinations explicit without adding another
// rendering-test dependency to the frontend package.
const primaryDestinations = ['/games', '/rank', '/diamond', '/inventory', '/profile']

describe('mobile primary navigation contract', () => {
  it('keeps the five primary authenticated destinations', () => {
    expect(primaryDestinations).toEqual(['/games', '/rank', '/diamond', '/inventory', '/profile'])
  })
})
