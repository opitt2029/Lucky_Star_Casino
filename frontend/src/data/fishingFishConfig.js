import fishingSpeciesContract from '../../../contracts/fishing-species.json'
export const JACKPOT_FISH_KING_ASSET =
  '/images/fishing/jackpot-fish-king-reference.png?v=20260707-reference-transparent'
export const JACKPOT_FISH_KING_DISPLAY_MULTIPLIER = 500
export const JACKPOT_FISH_KING_DISPLAY_HP = 5000
export const JACKPOT_FISH_KING_VISUAL_SCALE = 1.36
export const SPECIAL_FISH_CODES = new Set(['CAISHEN', 'MONEY_TREE'])

const FISH_ASSET_BY_CODE = {
  KOI: '/images/game/fishing/fish-clown-3d.svg',
  GOLDFISH: '/images/game/fishing/fish-gold-3d.svg',
  LANTERN: '/images/game/fishing/fish-lantern-3d.svg',
  PUFFER: '/images/game/fishing/fish-sapphire-3d.svg',
  ANGELFISH: '/images/game/fishing/fish-angel-3d.svg',
  DEVIL_RAY: '/images/game/fishing/fish-ray-crystal.svg',
  GOLD_DRAGON: '/images/game/fishing/fish-gold-dragon.svg',
  PIXIU: '/images/game/fishing/fish-pixiu.svg',
  CAISHEN: '/images/game/fishing/fish-caishen.svg',
  DRAGON_KING: '/images/fishing/gold-star-fish-king-reference.png?v=20260707-reference-transparent',
  MONEY_TREE: '/images/game/fishing/fish-money-tree.svg',
}

const RARITY_BY_TIER = {
  SMALL: 'Common',
  MEDIUM: 'Rare',
  HIGH: 'Epic',
  BOSS: 'Boss',
  SPECIAL: 'Special',
}

const TIER_DISPLAY = {
  SMALL: 'small',
  MEDIUM: 'medium',
  HIGH: 'high',
  BOSS: 'boss',
  SPECIAL: 'special',
}

function fishInfoFromContract(fish) {
  const hpPerMultiplier = fishingSpeciesContract.hpPerMultiplier || 10
  return {
    id: String(fish.code).toLowerCase().replaceAll('_', '-'),
    code: fish.code,
    name: fish.displayName,
    reward: fish.multiplier * 10,
    multiplier: `${fish.multiplier}x`,
    rarity: RARITY_BY_TIER[fish.tier] || fish.tier,
    tier: TIER_DISPLAY[fish.tier] || String(fish.tier).toLowerCase(),
    spawnRate: fish.spawnWeight,
    hp: fish.multiplier * hpPerMultiplier,
    asset: FISH_ASSET_BY_CODE[fish.code] || `/images/game/fishing/${fish.assetId}.svg`,
    assetId: fish.assetId,
    description: `${fish.displayName} uses the shared fishing species contract values.`,
  }
}

const CONTRACT_FISHING_FISH_INFO = fishingSpeciesContract.species.map(fishInfoFromContract)
export const FISHING_FISH_INFO = [
  ...CONTRACT_FISHING_FISH_INFO,
  {
    id: 'jackpot-fish-king',
    code: 'DRAGON_KING',
    name: '敶拚?擳?',
    reward: 5000,
    multiplier: '500x 敶拚?憭? / 200x ??',
    rarity: '?喳?',
    tier: 'legendary',
    spawnRate: 1,
    hp: JACKPOT_FISH_KING_DISPLAY_HP,
    displayMultiplier: JACKPOT_FISH_KING_DISPLAY_MULTIPLIER,
    displayHp: JACKPOT_FISH_KING_DISPLAY_HP,
    visualScale: JACKPOT_FISH_KING_VISUAL_SCALE,
    visualTier: 'LEGENDARY',
    catchDifficulty: 'boss',
    asset: JACKPOT_FISH_KING_ASSET,
    description: 'Jackpot visual variant for the Dragon King contract entry.',
  },
  {
    id: 'blocker-octopus',
    code: 'BLOCKER_OCTOPUS',
    name: '??蝡?',
    reward: 0,
    rewardLabel: '?閫貊?游◢',
    multiplier: '憭批? / 5??',
    rarity: '??',
    tier: 'blocker',
    spawnRate: 0.04,
    hp: 5,
    asset: '/images/fishing/blocker-octopus-reference.png?v=20260707-paeth-fix',
    description: 'Frontend-only blocker display entry.',
  },
  {
    id: 'blocker-starfish',
    code: 'BLOCKER_STARFISH',
    name: '??瘚瑟?',
    reward: 0,
    rewardLabel: '?閫貊?',
    multiplier: '憭批? / 5??',
    rarity: '??',
    tier: 'blocker',
    spawnRate: 0.04,
    hp: 5,
    asset: '/images/fishing/blocker-starfish-reference.png?v=20260707-paeth-fix',
    description: 'Frontend-only blocker display entry.',
  },
  {
    id: 'blocker-turtle',
    code: 'BLOCKER_TURTLE',
    name: '??瘚琿?',
    reward: 0,
    rewardLabel: '憭批??餅???',
    multiplier: '撠? / 銝?0 / 憭?7??',
    rarity: '??',
    tier: 'blocker',
    spawnRate: 0.04,
    hp: 10,
    asset: '/images/fishing/blocker-turtle-reference.png?v=20260707-paeth-fix',
    description: 'Frontend-only blocker display entry.',
  },
]

export function decorateFishingFishTable(fishTable = []) {
  return fishTable.flatMap((fish) => {
    const displayFish = SPECIAL_FISH_CODES.has(fish.code)
      ? {
          ...fish,
          tier: 'SPECIAL',
          visualTier: 'SPECIAL',
        }
      : fish

    if (displayFish.code !== 'DRAGON_KING' || displayFish.visualKey) return [displayFish]

    const backendWeight = Number(displayFish.spawnWeight)
    const totalWeight = Number.isFinite(backendWeight) && backendWeight > 0 ? backendWeight : 0
    const jackpotWeight = totalWeight > 1 ? 1 : 0
    const bossWeight = Math.max(0, totalWeight - jackpotWeight)

    return [
      {
        ...displayFish,
        name: '金星魚王',
        visualKey: 'gold-star-fish-king',
        assetId: displayFish.assetId || 'fish-dragon-king',
        spawnWeight: bossWeight,
      },
      {
        ...displayFish,
        name: '彩金魚王',
        visualKey: 'jackpot-fish-king',
        assetId: 'fish-rainbow-jackpot-fish-king',
        spawnWeight: jackpotWeight,
        displayMultiplier: JACKPOT_FISH_KING_DISPLAY_MULTIPLIER,
        displayHp: JACKPOT_FISH_KING_DISPLAY_HP,
        visualScale: JACKPOT_FISH_KING_VISUAL_SCALE,
        visualTier: 'LEGENDARY',
      },
    ].filter((variant) => variant.spawnWeight > 0)
  })
}
