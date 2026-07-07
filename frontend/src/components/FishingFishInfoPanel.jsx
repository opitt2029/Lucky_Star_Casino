import { FISHING_FISH_INFO } from '../data/fishingFishConfig'

export default function FishingFishInfoPanel({ betPerShot = 10 }) {
  return (
    <div className="fishing-lobby__fish-info" aria-label="捕魚機魚種與障礙介紹">
      <div className="fishing-lobby__fish-info-header">
        <span>Fish Guide</span>
        <strong>魚種與障礙資訊</strong>
      </div>
      <div className="fishing-lobby__fish-list">
        {FISHING_FISH_INFO.map((fish) => {
          const estimatedReward = Math.max(fish.reward, Number.parseInt(fish.multiplier, 10) * betPerShot || fish.reward)
          const rewardLabel = fish.rewardLabel || `${estimatedReward.toLocaleString()} 星幣`
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