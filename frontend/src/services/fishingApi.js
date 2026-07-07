import { FISHING_FISH_INFO, decorateFishingFishTable } from '../data/fishingFishConfig'
import { gameApi } from './gameApi'

function decorateSessionView(data) {
  if (!data) return data
  return {
    ...data,
    fishGuide: FISHING_FISH_INFO,
    fishTable: decorateFishingFishTable(data.fishTable),
  }
}

// Fishing-specific adapter over gameApi. The current backend exposes fishing under
// /api/v1/game/fishing, and gameApi already handles mock/real switching.
export const fishingApi = {
  active: async () => decorateSessionView(await gameApi.fishingActive()),
  start: async (payload) => decorateSessionView(await gameApi.fishingStart(payload)),
  shots: (payload) => gameApi.fishingShots(payload),
  topUp: (payload) => gameApi.fishingTopUp(payload),
  end: (payload) => gameApi.fishingEnd(payload),
  verifyShot: (payload) => gameApi.fishingVerifyShot(payload),
}
