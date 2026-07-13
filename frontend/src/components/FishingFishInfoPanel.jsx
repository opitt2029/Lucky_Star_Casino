import { getAsset } from '../casino-fx/assets/registry'
import { FISHING_FISH_INFO } from '../data/fishingFishConfig'

const TIER_LABELS = {
  SMALL: '小型魚',
  MEDIUM: '中型魚',
  HIGH: '高分魚',
  BOSS: 'Boss',
  SPECIAL: '特殊魚',
  LEGENDARY: '彩金魚王',
}

const TIER_DESCRIPTIONS = {
  SMALL: '容易擊殺，適合用來累積節奏與熟悉瞄準。獎勵較低，但出現頻率高。',
  MEDIUM: '血量與獎勵都比小型魚高，需要連續命中才比較穩。',
  HIGH: '高倍率目標，血量厚、出現較少，建議在炮台穩定時集中火力。',
  BOSS: '場上最高價值目標之一，需要多次命中。擊殺後仍會依後端機率判定是否捕獲。',
  SPECIAL: '特殊目標或干擾物，效果與一般魚不同，請看卡片說明。',
}

const GUIDE_COPY = {
  KOI: {
    name: '錦鯉',
    description: '最常見的小型魚。血量低、倍率低，適合新手練習開火節奏，也能穩定回收零散獎勵。',
  },
  PUFFER: {
    name: '河豚',
    description: '中型目標，血量明顯提高。連續命中後才容易收下，獎勵比小魚更有感。',
  },
  DEVIL_RAY: {
    name: '魔鬼魟',
    description: '高分目標，出現較少且比較耐打。建議鎖定同一隻持續攻擊，避免傷害分散。',
  },
  DRAGON_KING: {
    name: '金星魚王',
    description: 'Boss 級目標，血量與獎勵都最高。打到殘血不代表一定捕獲，最終結果以後端結算為準。',
  },
  'jackpot-fish-king': {
    name: '彩金魚王',
    description: '稀有魚王外觀，使用魚王的後端規則結算。看到牠時可以集中火力，但仍要留意剩餘子彈。',
  },
  BLOCKER_OCTOPUS: {
    name: '干擾章魚',
    description: '障礙物不會派獎。命中後會阻擋子彈並干擾視線，瞄準魚群時請避開。',
  },
  BLOCKER_STARFISH: {
    name: '干擾海星',
    description: '障礙物不會派獎。牠會擋住部分射線，容易讓子彈打不到真正目標。',
  },
  BLOCKER_TURTLE: {
    name: '干擾海龜',
    description: '較硬的障礙物不會派獎。需要多次命中才會消失，通常不值得優先攻擊。',
  },
}

const STATIC_BY_CODE = new Map()
for (const fish of FISHING_FISH_INFO) {
  if (!STATIC_BY_CODE.has(fish.code)) STATIC_BY_CODE.set(fish.code, fish)
}
const STATIC_BY_ID = new Map(FISHING_FISH_INFO.map((fish) => [fish.id, fish]))
const FALLBACK_FISH_GUIDE = FISHING_FISH_INFO.filter((fish) => fish.tier !== 'blocker').map(normalizeStaticFish)
const FALLBACK_BLOCKER_GUIDE = FISHING_FISH_INFO.filter((fish) => fish.tier === 'blocker').map(normalizeStaticFish)

function assetUrl(assetId, fallback) {
  const asset = getAsset(assetId)
  return asset?.type === 'image' ? asset.url : fallback
}

function displayCopyFor(fish, staticFish = {}) {
  return GUIDE_COPY[fish.visualKey] || GUIDE_COPY[fish.code] || GUIDE_COPY[staticFish.id] || {}
}

function formatRewardLabel(reward) {
  return reward > 0 ? `最高 ${reward.toLocaleString()} 星幣` : '不派獎'
}

function formatSpawnLabel(spawnRate) {
  const value = Number(spawnRate || 0)
  if (value <= 0) return '稀有出現'
  if (value < 1) return `出現率 ${Math.round(value * 100)}%`
  return `權重 ${value.toLocaleString()}`
}

function normalizeStaticFish(fish) {
  const copy = GUIDE_COPY[fish.id] || GUIDE_COPY[fish.code] || {}
  const tier = String(fish.tier || 'small').toUpperCase()
  const reward = Number(fish.reward || 0)

  return {
    ...fish,
    name: copy.name || fish.name || fish.code,
    reward,
    rewardLabel: fish.rewardLabel || formatRewardLabel(reward),
    multiplier: fish.multiplier || (reward > 0 ? `${reward / 10}x` : '障礙物'),
    rarity: TIER_LABELS[tier] || fish.rarity || tier,
    hp: Number(fish.hp || 0),
    spawnRate: fish.spawnRate ?? 0,
    description: copy.description || fish.description || TIER_DESCRIPTIONS[tier] || TIER_DESCRIPTIONS.SPECIAL,
  }
}

function backendFishToGuide(fish, betPerShot, index) {
  const tier = String(fish.tier || 'SMALL').toUpperCase()
  const multiplier = Number(fish.multiplier || 0)
  const visualStatic = fish.visualKey ? STATIC_BY_ID.get(fish.visualKey) : null
  const staticFish = visualStatic || STATIC_BY_CODE.get(fish.code) || {}
  const copy = displayCopyFor(fish, staticFish)
  const displayMultiplier = Number(fish.displayMultiplier ?? staticFish.displayMultiplier ?? multiplier)
  const displayHp = Number(fish.displayHp ?? staticFish.displayHp ?? fish.hp ?? staticFish.hp ?? 0)
  const payout = displayMultiplier * betPerShot
  const isVisualBoss = Boolean(fish.visualKey) && fish.code === 'DRAGON_KING'

  return {
    id: fish.visualKey || `${String(fish.code || 'fish').toLowerCase()}-${index}`,
    code: fish.code,
    name: copy.name || fish.name || staticFish.name || fish.code,
    reward: payout,
    rewardLabel: formatRewardLabel(payout),
    multiplier: isVisualBoss && displayMultiplier !== multiplier
      ? `${displayMultiplier}x 彩金外觀 / ${multiplier}x 合約`
      : `${displayMultiplier}x`,
    rarity: TIER_LABELS[tier] || staticFish.rarity || tier,
    tier: String(fish.visualTier || staticFish.visualTier || staticFish.tier || tier).toLowerCase(),
    spawnRate: fish.spawnWeight ?? staticFish.spawnRate ?? 0,
    hp: displayHp,
    asset: assetUrl(fish.assetId, staticFish.asset || '/images/game/fishing/fish-clown-3d.svg'),
    description: copy.description || staticFish.description || TIER_DESCRIPTIONS[tier] || TIER_DESCRIPTIONS.SPECIAL,
  }
}

function FishCard({ fish }) {
  const rewardLabel = fish.rewardLabel || formatRewardLabel(Number(fish.reward || 0))
  const hpLabel = fish.tier === 'blocker' ? `耐久 ${fish.hp}` : `HP ${Number(fish.hp || 0).toLocaleString()}`
  const spawnLabel = fish.tier === 'blocker' ? '障礙物' : formatSpawnLabel(fish.spawnRate)

  return (
    <article className={`fishing-lobby__fish-card is-${fish.tier}`}>
      <img src={fish.asset} alt="" className="fishing-lobby__fish-art" loading="lazy" />
      <div className="fishing-lobby__fish-body">
        <div className="fishing-lobby__fish-topline">
          <h4 className="fishing-lobby__fish-name">{fish.name}</h4>
          <span className="fishing-lobby__fish-rarity">{fish.rarity}</span>
        </div>
        <div className="fishing-lobby__fish-metrics" aria-label={`${fish.name} 數值`}>
          <span className="fishing-lobby__fish-reward">{rewardLabel}</span>
          <span className="fishing-lobby__fish-multiplier">{fish.multiplier}</span>
          <span className="fishing-lobby__fish-multiplier">{hpLabel}</span>
          <span className="fishing-lobby__fish-multiplier">{spawnLabel}</span>
        </div>
        <p>{fish.description}</p>
      </div>
    </article>
  )
}

export default function FishingFishInfoPanel({ betPerShot = 10, fishTable = [] }) {
  const seenBackendCodes = new Set()
  const backendGuide = (fishTable || [])
    .filter((fish) => fish?.code && !String(fish.code).startsWith('BLOCKER_'))
    .filter((fish) => {
      const code = String(fish.visualKey || fish.code)
      if (seenBackendCodes.has(code)) return false
      seenBackendCodes.add(code)
      return true
    })
    .map((fish, index) => backendFishToGuide(fish, betPerShot, index))
  const fishGuide = backendGuide.length ? backendGuide : FALLBACK_FISH_GUIDE

  return (
    <div className="fishing-lobby__fish-info" aria-label="捕魚機魚種、獎勵與障礙介紹">
      <div className="fishing-lobby__fish-info-header">
        <span>Fish Guide</span>
        <strong>魚種、獎勵與障礙說明</strong>
      </div>

      <section className="fishing-lobby__fish-section" aria-label="可捕獲魚種">
        <div className="fishing-lobby__section-title">
          <span>Reward Fish</span>
          <strong>可捕獲魚種</strong>
        </div>
        <div className="fishing-lobby__fish-list">
          {fishGuide.map((fish) => (
            <FishCard key={fish.id} fish={fish} />
          ))}
        </div>
      </section>

      <section className="fishing-lobby__fish-section fishing-lobby__fish-section--blockers" aria-label="障礙魚種">
        <div className="fishing-lobby__section-title">
          <span>Blockers</span>
          <strong>障礙魚種</strong>
        </div>
        <div className="fishing-lobby__blocker-list">
          {FALLBACK_BLOCKER_GUIDE.map((fish) => (
            <FishCard key={fish.id} fish={fish} />
          ))}
        </div>
      </section>
    </div>
  )
}
