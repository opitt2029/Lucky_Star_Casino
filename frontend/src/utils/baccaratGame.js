const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K']
const SUITS = ['spade', 'heart', 'diamond', 'club']

export const BET_TYPES = ['Player', 'Banker', 'Tie']

export const BET_LABELS = {
  Player: '閒家 Player',
  Banker: '莊家 Banker',
  Tie: '和局 Tie',
}

export const BET_ODDS = {
  Player: 1,
  Banker: 0.95,
  Tie: 8,
}

export function createDeck() {
  return SUITS.flatMap((suit) => RANKS.map((rank) => ({ rank, suit })))
}

export function drawCard(deck) {
  if (!deck.length) {
    return null
  }

  const cardIndex = Math.floor(Math.random() * deck.length)
  const [card] = deck.splice(cardIndex, 1)
  return card
}

export function calculateBaccaratScore(cards) {
  return (
    cards.reduce((sum, card) => {
      if (!card) return sum
      if (card.rank === 'A') return sum + 1
      if (['10', 'J', 'Q', 'K'].includes(card.rank)) return sum
      return sum + Number(card.rank)
    }, 0) % 10
  )
}

export function determineWinner(playerScore, bankerScore) {
  if (playerScore === bankerScore) return 'Tie'
  return playerScore > bankerScore ? 'Player' : 'Banker'
}

export function calculatePayout(selectedBet, winner, betAmount) {
  const amount = Number(betAmount)
  if (!selectedBet || selectedBet !== winner || !Number.isFinite(amount) || amount <= 0) {
    return -amount
  }

  return Math.floor(amount * BET_ODDS[selectedBet])
}
