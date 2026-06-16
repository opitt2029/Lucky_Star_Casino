import { pushAnnouncement } from './announceBus'

// 機器人喜報生成器：在後端 WebSocket 廣播建成前，營造「全服都有人在贏」的熱鬧氛圍。
// 暱稱中段打碼（龍**哥）模擬真實平台的隱私處理，也讓玩家自行腦補「是某個真人」。

const NICKNAMES = [
  '龍哥發財', '富貴滿堂', '小霸王', '財神到我家', '阿明哥', '錦鯉附體', '旺旺來',
  '金牌打手', '夜市人生', '貴妃醉酒', '臺北錢王', '高雄發哥', '幸運星人',
  '紅中白板', '梭哈大師', '七星高照', '黃金右手', '聚寶盆', '天選之人', '歐皇本皇',
]

const EVENTS = [
  // [權重, 模板函式]
  [30, (nick) => ({ kind: 'win', text: `${nick} 在老虎機轉出三連金龍，贏得 {amount} 星幣！`, min: 8000, max: 40000 })],
  [26, (nick) => ({ kind: 'win', text: `${nick} 百家樂連押連中，狂攬 {amount} 星幣！`, min: 5000, max: 30000 })],
  [22, (nick) => ({ kind: 'win', text: `${nick} 擊殺金貔貅，吞下 {amount} 星幣！`, min: 8800, max: 88888 })],
  [12, (nick) => ({ kind: 'jackpot', text: `恭喜 ${nick} 捕獲財神爺，紅包雨狂灑 {amount} 星幣！`, min: 50000, max: 188888, big: true })],
  [10, (nick) => ({ kind: 'boss', text: `全服警報：${nick} 單發轟殺龍王，獨吞 {amount} 星幣！`, min: 88888, max: 288888, big: true })],
]

const TOTAL_WEIGHT = EVENTS.reduce((sum, [weight]) => sum + weight, 0)

function maskNickname(nick) {
  if (nick.length <= 2) return `${nick[0]}*`
  return `${nick[0]}${'*'.repeat(nick.length - 2)}${nick[nick.length - 1]}`
}

function rollEvent() {
  let cursor = Math.random() * TOTAL_WEIGHT
  for (const [weight, build] of EVENTS) {
    if (cursor < weight) return build
    cursor -= weight
  }
  return EVENTS[0][1]
}

function fireOnce() {
  const nick = maskNickname(NICKNAMES[Math.floor(Math.random() * NICKNAMES.length)])
  const event = rollEvent()(nick)
  const amount = Math.round((event.min + Math.random() * (event.max - event.min)) / 88) * 88 // 尾數帶 8，討吉利
  pushAnnouncement({
    kind: event.kind,
    text: event.text.replace('{amount}', amount.toLocaleString()),
    big: Boolean(event.big),
  })
}

let timer = null

// 啟動機器人喜報（idempotent）。intervalRange 預設 18~45 秒一則，遊戲頁可調密。
export function startBotFeed({ minMs = 18000, maxMs = 45000, initialDelayMs = 6000 } = {}) {
  if (timer) return
  const schedule = (delay) => {
    timer = window.setTimeout(() => {
      fireOnce()
      schedule(minMs + Math.random() * (maxMs - minMs))
    }, delay)
  }
  schedule(initialDelayMs)
}

export function stopBotFeed() {
  if (timer) {
    window.clearTimeout(timer)
    timer = null
  }
}
