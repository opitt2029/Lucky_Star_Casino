import { getAsset } from '../casino-fx/assets/registry'
import { FISHING_FISH_INFO } from '../data/fishingFishConfig'

const TIER_LABELS = {
  SMALL: '常見',
  MEDIUM: '中階',
  HIGH: '高價',
  BOSS: 'Boss',
  SPECIAL: '特殊',
}

const TIER_DESCRIPTIONS = {
  SMALL: '小型魚種，血量較低、出現頻率高，適合用低面額穩定追擊。',
  MEDIUM: '中型魚種，耐打度與回饋都提升，命中後依後端 HP 持續累積傷害。',
  HIGH: '高價魚種，血量厚、倍率高，捕獲派彩完全以後端回應為準。',
  BOSS: 'Boss 魚王，後端仍使用 DRAGON_KING 合約；前端外觀只作視覺變體。',
  SPECIAL: '特殊魚種，捕獲後依後端規則結算派彩。',
}

const STATIC_BY_CODE = new Map()
for (const fish of FISHING_FISH_INFO) {
  if (!STATIC_BY_CODE.has(fish.code)) STATIC_BY_CODE.set(fish.code, fish)
}
const STATIC_BY_ID = new Map(FISHING_FISH_INFO.map((fish) => [fish.id, fish]))
const BLOCKER_GUIDE = FISHING_FISH_INFO.filter((fish) => fish.tier === 'blocker')

function assetUrl(assetId, fallback) {
  const asset = getAsset(assetId)
  return asset?.type === 'image' ? asset.url : fallback
}

function backendFishToGuide(fish, betPerShot, index) {
  const tier = String(fish.tier || 'SMALL').toUpperCase()
  const multiplier = Number(fish.multiplier || 0)
  const visualStatic = fish.visualKey ? STATIC_BY_ID.get(fish.visualKey) : null
  const staticFish = visualStatic || STATIC_BY_CODE.get(fish.code) || {}
  const payout = multiplier * betPerShot
  const isVisualBoss = Boolean(fish.visualKey) && fish.code === 'DRAGON_KING'

  return {
    id: fish.visualKey || `${String(fish.code || 'fish').toLowerCase()}-${index}`,
    code: fish.code,
    name: fish.name || staticFish.name || fish.code,
    reward: payout,
    rewardLabel: payout > 0 ? `捕獲 ${payout.toLocaleString()} 星幣` : '依後端回應',
    multiplier: isVisualBoss ? `${multiplier}x 合約 / 視覺外觀` : `${multiplier}x`,
    rarity: TIER_LABELS[tier] || staticFish.rarity || tier,
    tier: isVisualBoss ? 'legendary' : tier.toLowerCase(),
    spawnRate: fish.spawnWeight ?? staticFish.spawnRate ?? 0,
    hp: fish.hp ?? staticFish.hp ?? 0,
    asset: assetUrl(fish.assetId, staticFish.asset || '/images/game/fishing/fish-clown-3d.svg'),
    description:
      staticFish.description ||
      `${TIER_DESCRIPTIONS[tier] || '一般魚種，傷害、捕獲與派彩由後端 FishingCombat 判定。'} 實際浮字金額以 FishingShotsResponse.payout 為準。`,
  }
}

export default function FishingFishInfoPanel({ betPerShot = 10, fishTable = [] }) {
  const backendGuide = (fishTable || [])
    .filter((fish) => fish?.code && !String(fish.code).startsWith('BLOCKER_'))
    .map((fish, index) => backendFishToGuide(fish, betPerShot, index))
  const guide = backendGuide.length ? [...backendGuide, ...BLOCKER_GUIDE] : FISHING_FISH_INFO

  return (
    <div className="fishing-lobby__fish-info" aria-label="捕魚機魚種與障礙介紹">
      <div className="fishing-lobby__fish-info-header">
        <span>Fish Guide</span>
        <strong>魚種與障礙資訊</strong>
      </div>
      <div className="fishing-lobby__fish-list">
        {guide.map((fish) => {
          const rewardLabel = fish.rewardLabel || `${Number(fish.reward || 0).toLocaleString()} 星幣`
          const hpLabel =
            fish.tier === 'blocker'
              ? `擋 ${fish.hp} 發`
              : `HP ${Number(fish.hp || 0).toLocaleString()}`
          const spawnLabel =
            fish.tier === 'blocker' ? '不派彩' : `權重 ${Number(fish.spawnRate || 0).toLocaleString()}`
          return (
            <article key={fish.id} className={`fishing-lobby__fish-card is-${fish.tier}`}>
              <img src={fish.asset} alt="" className="fishing-lobby__fish-art" loading="lazy" />
              <div className="fishing-lobby__fish-body">
                <div className="fishing-lobby__fish-topline">
                  <h4 className="fishing-lobby__fish-name">{fish.name}</h4>
                  <span className="fishing-lobby__fish-rarity">{fish.rarity}</span>
                </div>
                <div className="fishing-lobby__fish-metrics">
                  <span className="fishing-lobby__fish-reward">{rewardLabel}</span>
                  <span className="fishing-lobby__fish-multiplier">{fish.multiplier}</span>
                  <span className="fishing-lobby__fish-multiplier">{hpLabel}</span>
                  <span className="fishing-lobby__fish-multiplier">{spawnLabel}</span>
                </div>
                <p>{fish.description}</p>
              </div>
            </article>
          )
        })}
      </div>
    </div>
  )
}
