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

    expect(variants.map((fish) => fish.name)).toEqual(['金星魚王', '彩金魚王'])

    for (const variant of variants) {
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

  test('marks Caishen and Money Tree as special display fish without changing payouts', () => {
    const caishen = {
      code: 'CAISHEN',
      name: 'Caishen',
      multiplier: 100,
      hp: 1000,
      tier: 'HIGH',
      spawnWeight: 6,
      assetId: 'fish-caishen',
    }
    const moneyTree = {
      code: 'MONEY_TREE',
      name: 'Money Tree',
      multiplier: 30,
      hp: 300,
      tier: 'SPECIAL',
      spawnWeight: 5,
      assetId: 'fish-money-tree',
    }

    expect(decorateFishingFishTable([caishen, moneyTree])).toEqual([
      {
        ...caishen,
        tier: 'SPECIAL',
        visualTier: 'SPECIAL',
      },
      {
        ...moneyTree,
        tier: 'SPECIAL',
        visualTier: 'SPECIAL',
      },
    ])
  })

  test('does not split already decorated Dragon King variants again', () => {
    const backendBoss = {
      code: 'DRAGON_KING',
      name: 'Dragon King',
      multiplier: 120,
      hp: 900,
      tier: 'BOSS',
      spawnWeight: 3,
      assetId: 'fish-dragon-king',
    }

    const once = decorateFishingFishTable([backendBoss])
    const twice = decorateFishingFishTable(once)

    expect(twice).toEqual(once)
  })
  test('does not decorate non-boss fish', () => {
    const koi = { code: 'KOI', name: 'Koi', multiplier: 2, hp: 20, tier: 'SMALL' }

    expect(decorateFishingFishTable([koi])).toEqual([koi])
  })
})