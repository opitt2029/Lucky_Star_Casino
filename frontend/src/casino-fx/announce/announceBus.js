// 全服喜報事件匯流排（極簡 pub/sub）。
// 機器人喜報（botFeed）與玩家真實大獎都走同一條管線；之後後端 WebSocket broker
// 建好後，把 STOMP topic 的訊息轉成 pushAnnouncement() 即可無縫升級成真全服廣播。

const listeners = new Set()

/**
 * @param {object} announcement
 *   { id, kind: 'win'|'jackpot'|'boss', playerName, game, prize, amount, big }
 *   big = true 時 Ticker 會附帶全屏金幣微特效。
 */
export function pushAnnouncement(announcement) {
  const payload = {
    id: announcement.id || `ann-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    createdAt: Date.now(),
    ...announcement,
  }
  listeners.forEach((listener) => listener(payload))
}

export function subscribeAnnouncements(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

const GAME_NAMES = { slot: '老虎機', baccarat: '百家樂', fishing: '捕魚機' }

// 玩家自己大獎時的便捷入口（遊戲頁呼叫），自動組成喜報文案。
export function announcePlayerWin({ playerName, game, prize, amount }) {
  const name = playerName || '幸運星玩家'
  const gameName = GAME_NAMES[game] || game || '遊戲'
  const action = prize ? `在${gameName}擊殺${prize}` : `在${gameName}`
  const amountText = amount ? `狂攬 ${Number(amount).toLocaleString()} 星幣` : '抱走大獎'
  pushAnnouncement({
    kind: 'jackpot',
    text: `恭喜 ${name} ${action}${amountText}！`,
    big: true,
  })
}
