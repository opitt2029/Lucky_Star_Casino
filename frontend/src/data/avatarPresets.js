import casinoFemaleBlackjackDealer from '../assets/avatars/casino-female-blackjack-dealer.webp'
import casinoFemalePokerAce from '../assets/avatars/casino-female-poker-ace.webp'
import casinoFemaleRouletteHost from '../assets/avatars/casino-female-roulette-host.webp'
import casinoMaleDealer from '../assets/avatars/casino-male-dealer.webp'
import casinoMaleHighRoller from '../assets/avatars/casino-male-high-roller.webp'
import casinoMaleSlotChampion from '../assets/avatars/casino-male-slot-champion.webp'

export const avatarPresets = [
  { id: 'male-dealer', label: 'Golden Dealer', src: casinoMaleDealer },
  { id: 'male-high-roller', label: 'High Roller', src: casinoMaleHighRoller },
  { id: 'male-slot-champion', label: 'Slot Champion', src: casinoMaleSlotChampion },
  { id: 'female-blackjack-dealer', label: 'Blackjack Dealer', src: casinoFemaleBlackjackDealer },
  { id: 'female-roulette-host', label: 'Roulette Host', src: casinoFemaleRouletteHost },
  { id: 'female-poker-ace', label: 'Poker Ace', src: casinoFemalePokerAce },
]

function hashSeed(value) {
  const seed = String(value || 'lucky-star-player')
  let hash = 0
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) >>> 0
  }
  return hash
}

export function getAvatarPresetForPlayer(player) {
  const seed = player?.playerId ?? player?.id ?? player?.username ?? player?.nickname ?? player?.name
  return avatarPresets[hashSeed(seed) % avatarPresets.length]
}