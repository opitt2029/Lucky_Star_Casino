// TODO: replace this frontend display config with a backend fishing settings endpoint when available.
export const JACKPOT_FISH_KING_ASSET =
  '/images/fishing/jackpot-fish-king-reference.png?v=20260707-reference-transparent'
export const JACKPOT_FISH_KING_DISPLAY_MULTIPLIER = 500
export const JACKPOT_FISH_KING_DISPLAY_HP = 5000
export const JACKPOT_FISH_KING_VISUAL_SCALE = 1.36

export const FISHING_FISH_INFO = [
  {
    id: 'clownfish',
    code: 'KOI',
    name: '錦鯉',
    reward: 20,
    multiplier: '2x',
    rarity: '常見',
    tier: 'small',
    spawnRate: 0.25,
    hp: 20,
    asset: '/images/game/fishing/fish-clown-3d.svg',
    description: '小型魚種，血量低、出現頻率高，適合用低倍率砲彈穩定累積回饋。',
  },
  {
    id: 'puffer',
    code: 'PUFFER',
    name: '河豚',
    reward: 80,
    multiplier: '8x',
    rarity: '稀有',
    tier: 'medium',
    spawnRate: 0.12,
    hp: 80,
    asset: '/images/game/fishing/fish-sapphire-3d.svg',
    description: '中型魚種，耐打度與回饋都比小魚更高，適合用中階砲台追擊。',
  },
  {
    id: 'devil-ray',
    code: 'DEVIL_RAY',
    name: '魔鬼魟',
    reward: 250,
    multiplier: '25x',
    rarity: '高價',
    tier: 'medium',
    spawnRate: 0.06,
    hp: 250,
    asset: '/images/game/fishing/fish-ray-crystal.svg',
    description: '高價魚種，血量較厚、游速較快，命中後有機會帶來更高倍率回饋。',
  },
  {
    id: 'dragon-king',
    code: 'DRAGON_KING',
    name: '金星魚王',
    reward: 2000,
    multiplier: '200x',
    rarity: 'Boss',
    tier: 'boss',
    spawnRate: 0.02,
    hp: 2000,
    asset: '/images/fishing/gold-star-fish-king-reference.png?v=20260707-reference-transparent',
    description: 'Boss 級魚王，後端仍沿用 DRAGON_KING 合約結算，適合高階砲台集中輸出。',
  },
  {
    id: 'jackpot-fish-king',
    code: 'DRAGON_KING',
    name: '彩金魚王',
    reward: 5000,
    multiplier: '500x 彩金外觀 / 200x 合約',
    rarity: '傳奇',
    tier: 'legendary',
    spawnRate: 0.01,
    hp: JACKPOT_FISH_KING_DISPLAY_HP,
    displayMultiplier: JACKPOT_FISH_KING_DISPLAY_MULTIPLIER,
    displayHp: JACKPOT_FISH_KING_DISPLAY_HP,
    visualScale: JACKPOT_FISH_KING_VISUAL_SCALE,
    visualTier: 'LEGENDARY',
    catchDifficulty: 'boss',
    asset: JACKPOT_FISH_KING_ASSET,
    description: '傳奇魚王，彩金外觀與最大體型；實際捕獲派彩以後端 DRAGON_KING 回傳 payout 為準。',
  },
  {
    id: 'blocker-octopus',
    code: 'BLOCKER_OCTOPUS',
    name: '障礙章魚',
    reward: 0,
    rewardLabel: '擊破觸發噴墨',
    multiplier: '大型 / 5發',
    rarity: '障礙',
    tier: 'blocker',
    spawnRate: 0.04,
    hp: 5,
    asset: '/images/fishing/blocker-octopus-reference.png?v=20260707-paeth-fix',
    description: '大型章魚障礙物，5 發擊破後會噴墨遮蔽漁場視野 2 秒。',
  },
  {
    id: 'blocker-starfish',
    code: 'BLOCKER_STARFISH',
    name: '障礙海星',
    reward: 0,
    rewardLabel: '擊破觸發加速',
    multiplier: '大型 / 5發',
    rarity: '障礙',
    tier: 'blocker',
    spawnRate: 0.04,
    hp: 5,
    asset: '/images/fishing/blocker-starfish-reference.png?v=20260707-paeth-fix',
    description: '大型海星障礙物，5 發擊破後會讓目前魚群加速 2 秒。',
  },
  {
    id: 'blocker-turtle',
    code: 'BLOCKER_TURTLE',
    name: '障礙海龜',
    reward: 0,
    rewardLabel: '大型阻擋物',
    multiplier: '小5 / 中10 / 大17發',
    rarity: '障礙',
    tier: 'blocker',
    spawnRate: 0.04,
    hp: 10,
    asset: '/images/fishing/blocker-turtle-reference.png?v=20260707-paeth-fix',
    description:
      '海龜保留小 / 中 / 大尺寸與 5 / 10 / 17 發擊破次數，但整體體型更大、遮擋範圍更明顯。',
  },
]

export function decorateFishingFishTable(fishTable = []) {
  return fishTable.flatMap((fish) => {
    if (fish.code !== 'DRAGON_KING') return [fish]

    const backendWeight = Number(fish.spawnWeight)
    const totalWeight = Number.isFinite(backendWeight) && backendWeight > 0 ? backendWeight : 0
    const jackpotWeight = totalWeight > 1 ? 1 : 0
    const bossWeight = Math.max(0, totalWeight - jackpotWeight)

    return [
      {
        ...fish,
        visualKey: 'gold-star-fish-king',
        assetId: fish.assetId || 'fish-dragon-king',
        spawnWeight: bossWeight,
      },
      {
        ...fish,
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
