export const FISHING_SKILLS = [
  { id: 'freeze', label: '冰凍', status: '展示中', tone: 'cyan' },
  { id: 'laser', label: '雷射', status: '展示中', tone: 'violet' },
  { id: 'coin-rain', label: '金幣雨', status: '展示中', tone: 'gold' },
]

export const FISHING_DISPLAY_SPECIES = [
  {
    id: 'clownfish',
    name: '小丑魚',
    multiplier: '2x - 5x',
    rarity: '常見',
    description: '小型高速魚群，適合用低面額連射累積手感。',
    swatch: 'linear-gradient(135deg, #ff8a2a, #fff4c7 48%, #ff5b35)',
  },
  {
    id: 'sapphire',
    name: '藍寶石魚',
    multiplier: '8x - 18x',
    rarity: '中階',
    description: '藍色霓虹邊緣與中等血量，回饋穩定、適合追擊。',
    swatch: 'linear-gradient(135deg, #5df0ff, #226cff 55%, #061d5f)',
  },
  {
    id: 'gold',
    name: '黃金魚',
    multiplier: '25x - 60x',
    rarity: '高價',
    description: '金屬光澤魚身，擊殺後有較高派彩機會。',
    swatch: 'linear-gradient(135deg, #fff4a8, #f2b632 48%, #8d3f08)',
  },
  {
    id: 'crystal-ray',
    name: '水晶魟魚',
    multiplier: '80x - 120x',
    rarity: '稀有',
    description: '半透明紫藍光暈，移動較慢但血量更厚。',
    swatch: 'linear-gradient(135deg, rgba(173,247,255,.9), rgba(137,79,255,.82), rgba(255,255,255,.35))',
  },
  {
    id: 'jackpot-whale',
    name: '彩金鯨王',
    multiplier: '200x+',
    rarity: '首領',
    description: '紅金彩金光環與首領體型，需要集中火力才有機會捕獲。',
    swatch: 'linear-gradient(135deg, #5d0614, #ff3f60 35%, #ffd76d 70%, #2b0610)',
  },
]

export const FISHING_JACKPOT = {
  label: '深海彩金池',
  amount: 888888,
  bonusText: '彩金鯨王倒數巡游中',
}
export const FISHING_BLOCKER_GUIDE = [
  {
    id: 'octopus',
    name: '障礙章魚',
    effect: '5 發擊破',
    description: '擊破後噴墨遮蔽漁場視野 2 秒。',
    tone: 'ink',
  },
  {
    id: 'starfish',
    name: '障礙海星',
    effect: '5 發擊破',
    description: '擊破後目前魚群加速 2 秒，障礙魚不加速。',
    tone: 'speed',
  },
  {
    id: 'turtle',
    name: '障礙海龜',
    effect: '5 / 10 / 17 發',
    description: '小中大尺寸保留原擊破次數，但體型更大、遮擋更明顯。',
    tone: 'armor',
  },
]
