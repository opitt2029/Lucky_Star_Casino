import { describe, expect, test } from 'vitest'
import {
  JACKPOT_FISH_KING_DISPLAY_HP,
  JACKPOT_FISH_KING_DISPLAY_MULTIPLIER,
  JACKPOT_FISH_KING_VISUAL_SCALE,
  decorateFishingFishTable,
} from './fishingFishConfig'

describe('decorateFishingFishTable', () => {
  test('splits Dragon King into gold and jackpot visuals without changing backend contract values', () => {
    const backendBoss = {
      code: 'DRAGON_KING',
      name: 'Dragon King',
      multiplier: 120,
      hp: 900,
      tier: 'BOSS',
      spawnWeight: 3,
      assetId: 'fish-dragon-king',
    }

    const variants = decorateFishingFishTable([backendBoss])

    expect(variants).toHaveLength(2)
    expect(variants.reduce((sum, fish) => sum + fish.spawnWeight, 0)).toBe(3)
    expect(variants.map((fish) => fish.visualKey)).toEqual([
      'gold-star-fish-king',
      'jackpot-fish-king',
    ])

    for (const variant of variants) {
      expect(variant.name).toBe('Dragon King')
      expect(variant.multiplier).toBe(120)
      expect(variant.hp).toBe(900)
      expect(variant.tier).toBe('BOSS')
      expect(variant).not.toHaveProperty('visualMultiplier')
    }

    const jackpot = variants.find((fish) => fish.visualKey === 'jackpot-fish-king')
    expect(jackpot).toMatchObject({
      assetId: 'fish-rainbow-jackpot-fish-king',
      displayMultiplier: JACKPOT_FISH_KING_DISPLAY_MULTIPLIER,
      displayHp: JACKPOT_FISH_KING_DISPLAY_HP,
      visualScale: JACKPOT_FISH_KING_VISUAL_SCALE,
      visualTier: 'LEGENDARY',
    })
  })

  test('does not decorate non-boss fish', () => {
    const koi = { code: 'KOI', name: 'Koi', multiplier: 2, hp: 20, tier: 'SMALL' }

    expect(decorateFishingFishTable([koi])).toEqual([koi])
  })
})