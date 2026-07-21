// Provably Fair 展示頁專用的本機模擬（方案 A，spec §4）。
// 純函式：以 Web Crypto 完整重現後端 rng/RandomStream 的 SHA-256 串流，
// 自產「真正可用同一支函式重算」的對局。數值來源沿用 contracts/*.json（與 mockApi 同源）。
// 誠實性（spec §4）：mock 的「重算」是前端拿同一支函式再跑一次，必然相符；
// 這不構成對後端的獨立驗證——UI 以徽章＋說明明示。

import slotPaytableContract from '../../../contracts/slot-paytable.json'
import baccaratRulesContract from '../../../contracts/baccarat-rules.json'
import fishingSpeciesContract from '../../../contracts/fishing-species.json'
import fishingCombatContract from '../../../contracts/fishing-combat.json'

const encoder = new TextEncoder()

// UTF-8 → SHA-256 → 小寫 hex（對齊後端 ProvablyFairRng.sha256Hex）。
export async function sha256Hex(str) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(str))
  return bytesToHex(new Uint8Array(digest))
}

// 承諾雜湊 commitment = SHA-256(serverSeed)（對齊後端 ProvablyFairRng.commit）。
export async function commit(serverSeed) {
  return sha256Hex(serverSeed)
}

// 產生 byteLength 位元組的密碼學亂數，回小寫 hex。
export function randomHex(byteLength) {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength))
  return bytesToHex(bytes)
}

function bytesToHex(bytes) {
  let hex = ''
  for (const b of bytes) hex += b.toString(16).padStart(2, '0')
  return hex
}

// 區塊訊息 serverSeed:clientSeed:nonce:block（對齊後端 RandomStream.blockMessage）。
async function sha256Bytes(str) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(str))
  return new Uint8Array(digest)
}

// 由 (serverSeed, clientSeed, nonce) 建立確定性串流。介面全 async：
// 位元組用罄時「按需」以遞增 block 再雜湊延伸（對齊後端 nextByte），不預算固定塊數。
export function createStream(serverSeed, clientSeed, nonce) {
  if (!serverSeed) throw new Error('serverSeed 不可為空')
  if (!clientSeed) throw new Error('clientSeed 不可為空')
  let buffer = new Uint8Array(0)
  let position = 0
  let nextBlock = 0

  async function nextByte() {
    if (position >= buffer.length) {
      buffer = await sha256Bytes(`${serverSeed}:${clientSeed}:${nonce}:${nextBlock}`)
      nextBlock += 1
      position = 0
    }
    return buffer[position++]
  }

  async function nextU32() {
    let u = 0
    for (let i = 0; i < 4; i++) u = u * 256 + (await nextByte()) // big-endian，避免 <<32 溢位
    return u
  }

  async function nextDouble() {
    return (await nextU32()) / 4294967296 // 2^32
  }

  async function nextInt(bound) {
    if (!Number.isInteger(bound) || bound <= 0) throw new Error(`bound 必須為正整數，實際為 ${bound}`)
    const range = 4294967296 // 2^32
    const limit = range - (range % bound)
    // 拒絕取樣：落在不可整除尾段者丟棄，消除取模偏差（對齊後端）。
    while (true) {
      const u = await nextU32()
      if (u < limit) return u % bound
    }
  }

  async function nextInts(count, bound) {
    const out = []
    for (let i = 0; i < count; i++) out.push(await nextInt(bound))
    return out
  }

  return { nextByte, nextDouble, nextInt, nextInts }
}

const STORE_KEY = 'lucky-star-fairness-rounds-v1'

// ---- 對局存檔（供 settle/verify 回放；本頁自成一格，與 mockApi 的 DB 分開）----
function loadRounds() {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY)) || {}
  } catch {
    return {}
  }
}
function saveRound(roundId, record) {
  const all = loadRounds()
  all[roundId] = record
  // 僅保留近 50 局，避免 localStorage 膨脹。
  const keys = Object.keys(all)
  if (keys.length > 50) delete all[keys[0]]
  localStorage.setItem(STORE_KEY, JSON.stringify(all))
}
function getRound(roundId) {
  return loadRounds()[roundId] || null
}

// ============ 老虎機（鏡像 mockApi 的 SLOT_PAYTABLE / evaluateSlotLine，隨機源改串流）============
const SLOT_SYMBOLS = slotPaytableContract.symbols
const SLOT_TOTAL_WEIGHT = slotPaytableContract.totalWeight
const SLOT_BY_DISPLAY = Object.fromEntries(SLOT_SYMBOLS.map((s) => [s.display, s]))

async function pickSlotSymbol(stream) {
  let cursor = await stream.nextInt(SLOT_TOTAL_WEIGHT)
  for (const s of SLOT_SYMBOLS) {
    if (cursor < s.weight) return s.display
    cursor -= s.weight
  }
  return SLOT_SYMBOLS[SLOT_SYMBOLS.length - 1].display // 理論不可達
}

async function deriveSlotGrid(stream) {
  const grid = []
  for (let r = 0; r < 3; r++) {
    const row = []
    for (let c = 0; c < 3; c++) row.push(await pickSlotSymbol(stream))
    grid.push(row)
  }
  return grid
}

// 中線兩階評估（鏡像 mockApi.evaluateSlotLine）。
function evaluateSlotLine(grid) {
  const [a, b, c] = grid[1]
  if (a === b && b === c) {
    return { multiplier: SLOT_BY_DISPLAY[a].tripleMultiplier, winningCells: [[1, 0], [1, 1], [1, 2]] }
  }
  if (a === b) {
    return { multiplier: SLOT_BY_DISPLAY[a].pairMultiplier, winningCells: [[1, 0], [1, 1]] }
  }
  return { multiplier: 0, winningCells: [] }
}

// 由已存對局重算盤面與派彩（settle 與 verify 共用；同一支函式 → 必然相符）。
async function recomputeSlot(serverSeed, clientSeed, nonce, bet) {
  const grid = await deriveSlotGrid(createStream(serverSeed, clientSeed, nonce))
  const { multiplier, winningCells } = evaluateSlotLine(grid)
  return { grid, multiplier, winningCells, payout: bet * multiplier }
}

// ============ 百家樂（鏡像 mockApi 的 dealBaccarat / 補牌表 / 賠付）============
const BACCARAT_VALUES = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K']
const BACCARAT_TIE_RATIO = baccaratRulesContract.tiePayoutRatio
const BACCARAT_COMMISSION = baccaratRulesContract.bankerCommissionRate
const BANKER_DRAW_TABLE = baccaratRulesContract.bankerDraws

function cardValue(card) {
  if (card === 'A') return 1
  if (['J', 'Q', 'K', '10'].includes(card)) return 0
  return Number(card)
}
function points(cards) {
  return cards.reduce((sum, c) => sum + cardValue(c), 0) % 10
}
async function drawCard(stream) {
  return BACCARAT_VALUES[await stream.nextInt(BACCARAT_VALUES.length)]
}
function bankerDraws(bankerScore, playerThirdValue) {
  if (playerThirdValue === null) return bankerScore <= BANKER_DRAW_TABLE.whenPlayerStandsDrawOnMax
  return (BANKER_DRAW_TABLE.byBankerScore[String(bankerScore)] || []).includes(playerThirdValue)
}
function baccaratPayoutFor(area, winner, amount) {
  if (amount <= 0) return 0
  if (winner === 'tie') return area === 'tie' ? amount * (1 + BACCARAT_TIE_RATIO) : amount
  if (area !== winner) return 0
  if (area === 'banker') return amount * 2 - Math.floor(amount * BACCARAT_COMMISSION)
  return amount * 2
}

async function recomputeBaccarat(serverSeed, clientSeed, nonce, bets) {
  const stream = createStream(serverSeed, clientSeed, nonce)
  const player = [await drawCard(stream), await drawCard(stream)]
  const banker = [await drawCard(stream), await drawCard(stream)]
  let playerScore = points(player)
  let bankerScore = points(banker)
  if (playerScore < 8 && bankerScore < 8) {
    let playerThird = null
    if (playerScore <= 5) {
      const t = await drawCard(stream)
      player.push(t)
      playerThird = cardValue(t)
      playerScore = points(player)
    }
    if (bankerDraws(bankerScore, playerThird)) {
      banker.push(await drawCard(stream))
      bankerScore = points(banker)
    }
  }
  const result =
    playerScore === bankerScore ? 'TIE' : playerScore > bankerScore ? 'PLAYER' : 'BANKER'
  const winner = result.toLowerCase()
  const payouts = {
    player: baccaratPayoutFor('player', winner, bets.player || 0),
    banker: baccaratPayoutFor('banker', winner, bets.banker || 0),
    tie: baccaratPayoutFor('tie', winner, bets.tie || 0),
  }
  const totalBet = (bets.player || 0) + (bets.banker || 0) + (bets.tie || 0)
  const totalPayout = payouts.player + payouts.banker + payouts.tie
  const rebate = Math.max(1, Math.floor(totalBet * 0.005))
  return {
    playerCards: player,
    bankerCards: banker,
    playerScore,
    bankerScore,
    result,
    payouts,
    totalBet,
    totalPayout,
    rebate,
  }
}

// ============ 捕魚機（鏡像 mockApi 的 HP/pCapture 模型；每發 nonce=shotSeq，逐發可回放）============
const FISH_SPECIES = fishingSpeciesContract.species
const FISH_BY_CODE = Object.fromEntries(FISH_SPECIES.map((f) => [f.code, f]))
const FISH_HP_PER_MULT = fishingSpeciesContract.hpPerMultiplier
const FISH_CRIT_CHANCE = fishingCombatContract.critChance
const FISH_CRIT_MULT = fishingCombatContract.critMultiplier
const FISH_CANNON_DAMAGE = fishingCombatContract.cannonDamage
const FISH_TARGET_RTP = fishingCombatContract.targetRtp
const FISH_MONEY_MIN = fishingSpeciesContract.moneyTreeMultiplier.min
const FISH_MONEY_MAX = fishingSpeciesContract.moneyTreeMultiplier.max

function fishHp(fish) {
  return fish.multiplier * FISH_HP_PER_MULT
}
function expectedShotsToKill(hp, damage) {
  if (hp <= 0) return 0
  const units = Math.ceil(hp / damage)
  const g = new Array(units + 2).fill(0)
  for (let u = units - 1; u >= 0; u--) {
    g[u] = 1 + (1 - FISH_CRIT_CHANCE) * g[u + 1] + FISH_CRIT_CHANCE * g[u + 2]
  }
  return g[0]
}
function pCapture(fish, cannonLevel) {
  const eN = expectedShotsToKill(fishHp(fish), FISH_CANNON_DAMAGE[cannonLevel])
  return Math.min(1, (FISH_TARGET_RTP * eN) / fish.multiplier)
}

// 逐發判定：純函式（serverSeed, clientSeed, shotSeq, fishType, betPerShot, cannonLevel, damageBefore）。
// nonce=shotSeq → 每發獨立可回放，對齊後端 verify-shot「replay 該發判定」語意。
async function deriveShot(serverSeed, clientSeed, shotSeq, fish, betPerShot, cannonLevel, damageBefore) {
  const stream = createStream(serverSeed, clientSeed, shotSeq)
  const crit = (await stream.nextDouble()) < FISH_CRIT_CHANCE
  const damage = FISH_CANNON_DAMAGE[cannonLevel] * (crit ? FISH_CRIT_MULT : 1)
  const after = damageBefore + damage
  const hp = fishHp(fish)
  const killed = after >= hp
  let captured = false
  let payout = 0
  let hpRemaining = 0
  if (!killed) {
    hpRemaining = hp - after
  } else {
    captured = (await stream.nextDouble()) < pCapture(fish, cannonLevel)
    if (captured) {
      const factor =
        fish.code === 'MONEY_TREE'
          ? FISH_MONEY_MIN + (await stream.nextInt(FISH_MONEY_MAX - FISH_MONEY_MIN + 1))
          : fish.multiplier
      payout = betPerShot * factor
    }
  }
  return { crit, damage, after, killed, captured, payout, hpRemaining }
}

// ============ 對外 API（形狀對齊後端；供 fairnessApi 消費）============
export const provablyFairMock = {
  // 老虎機 ①承諾
  async slotRound({ bet, clientSeed }) {
    const serverSeed = randomHex(32)
    const cs = clientSeed || randomHex(16)
    const roundId = `MOCK-SLOT-${Date.now()}`
    saveRound(roundId, { gameType: 'SLOT', serverSeed, clientSeed: cs, nonce: 0, bet, settled: false })
    return { roundId, game: 'slot', bet, serverSeedHash: await commit(serverSeed), clientSeed: cs }
  },

  // 老虎機 ②③④開獎＋揭露
  async slotSettle({ roundId }) {
    const round = getRound(roundId)
    if (!round || round.gameType !== 'SLOT') throw new Error('查無此對局')
    const { serverSeed, clientSeed, nonce, bet } = round
    const { grid, multiplier, winningCells, payout } = await recomputeSlot(serverSeed, clientSeed, nonce, bet)
    saveRound(roundId, { ...round, settled: true, result: { grid, multiplier, winningCells, payout } })
    return {
      roundId,
      game: 'slot',
      grid,
      bet,
      multiplier,
      payout,
      winningCells,
      serverSeed,
      serverSeedHash: await commit(serverSeed),
      clientSeed,
      nonce,
    }
  },

  // 百家樂 ①②承諾＋下注（mock 亦即刻扣款語意，實際餘額由 fairnessApi 真實模式才動）
  async baccaratBet({ player = 0, banker = 0, tie = 0, clientSeed }) {
    const serverSeed = randomHex(32)
    const cs = clientSeed || randomHex(16)
    const bets = { player, banker, tie }
    const totalBet = player + banker + tie
    const roundId = `MOCK-BAC-${Date.now()}`
    saveRound(roundId, { gameType: 'BACCARAT', serverSeed, clientSeed: cs, nonce: 0, bets, settled: false })
    return { roundId, game: 'baccarat', bets, totalBet, serverSeedHash: await commit(serverSeed), clientSeed: cs }
  },

  // 百家樂 ③④開獎＋揭露
  async baccaratResult({ roundId }) {
    const round = getRound(roundId)
    if (!round || round.gameType !== 'BACCARAT') throw new Error('查無此對局')
    const { serverSeed, clientSeed, nonce, bets } = round
    const r = await recomputeBaccarat(serverSeed, clientSeed, nonce, bets)
    saveRound(roundId, { ...round, settled: true, result: r })
    return {
      roundId,
      game: 'baccarat',
      ...r,
      bets,
      serverSeed,
      serverSeedHash: await commit(serverSeed),
      clientSeed,
      nonce,
    }
  },

  // 老虎機／百家樂共用 ⑤驗證
  async verifyRound({ roundId, serverSeed: provided }) {
    const round = getRound(roundId)
    if (!round) throw new Error('查無此對局')
    if (!round.settled) throw new Error('對局尚未結算，無法驗證')
    const usedProvidedSeed = provided != null && provided !== ''
    const seed = usedProvidedSeed ? provided : round.serverSeed
    const serverSeedHash = await commit(round.serverSeed) // 對局公布的承諾（永遠是原始 seed 的）
    const commitmentValid = (await commit(seed)) === serverSeedHash
    // 以 seed 重算，和已存結果比對。
    let recomputed
    if (round.gameType === 'SLOT') {
      recomputed = await recomputeSlot(seed, round.clientSeed, round.nonce, round.bet)
    } else {
      recomputed = await recomputeBaccarat(seed, round.clientSeed, round.nonce, round.bets)
    }
    const resultMatches = commitmentValid && JSON.stringify(recomputed) === JSON.stringify(round.result)
    const valid = commitmentValid && resultMatches
    return {
      roundId,
      gameType: round.gameType,
      serverSeed: seed,
      serverSeedHash,
      clientSeed: round.clientSeed,
      nonce: round.nonce,
      usedProvidedSeed,
      commitmentValid,
      resultMatches,
      valid,
      recomputed,
      stored: round.result,
      message: valid
        ? '承諾相符，重算結果與紀錄一致。'
        : !commitmentValid
          ? '承諾雜湊不符：提供的 serverSeed 與本局公布的 serverSeedHash 不相符。'
          : '重算結果與紀錄不一致。',
    }
  },

  // 捕魚機 ①承諾
  async fishingStart({ buyIn, cannonLevel = 1, betPerShot = 10, clientSeed }) {
    const serverSeed = randomHex(32)
    const cs = clientSeed || randomHex(16)
    const sessionId = `MOCK-FISH-${Date.now()}`
    saveRound(sessionId, {
      gameType: 'FISHING',
      serverSeed,
      clientSeed: cs,
      cannonLevel,
      betPerShot,
      buyIn,
      shots: {},
      fishDamage: {},
      settled: false,
    })
    return { sessionId, serverSeedHash: await commit(serverSeed), clientSeed: cs, cannonLevel, betPerShot, buyIn }
  },

  // 捕魚機 ②③射擊（逐發 nonce=shotSeq；累傷存 session 供顯示）
  async fishingShots({ sessionId, shots }) {
    const round = getRound(sessionId)
    if (!round || round.gameType !== 'FISHING') throw new Error('場次不存在')
    const results = []
    for (const shot of shots) {
      const fish = FISH_BY_CODE[String(shot.fishType || '').toUpperCase()]
      if (!fish) throw new Error(`未知魚種：${shot.fishType}`)
      const instanceId = shot.fishInstanceId || `seq-${shot.shotSeq}`
      const damageBefore = round.fishDamage[instanceId] || 0
      const d = await deriveShot(
        round.serverSeed,
        round.clientSeed,
        shot.shotSeq,
        fish,
        round.betPerShot,
        round.cannonLevel,
        damageBefore,
      )
      if (d.killed) delete round.fishDamage[instanceId]
      else round.fishDamage[instanceId] = d.after
      const record = {
        shotSeq: shot.shotSeq,
        fishType: fish.code,
        betPerShot: round.betPerShot,
        crit: d.crit,
        damage: d.damage,
        killed: d.killed,
        captured: d.captured,
        payout: d.payout,
      }
      round.shots[String(shot.shotSeq)] = record
      results.push({ ...record, hpRemaining: d.hpRemaining })
    }
    saveRound(sessionId, round)
    return { sessionId, results }
  },

  // 捕魚機 ④揭露
  async fishingEnd({ sessionId }) {
    const round = getRound(sessionId)
    if (!round || round.gameType !== 'FISHING') throw new Error('場次不存在')
    saveRound(sessionId, { ...round, settled: true })
    const totalPayout = Object.values(round.shots).reduce((s, r) => s + r.payout, 0)
    return {
      sessionId,
      serverSeed: round.serverSeed,
      serverSeedHash: await commit(round.serverSeed),
      clientSeed: round.clientSeed,
      totalPayout,
    }
  },

  // 捕魚機 ⑤逐發驗證
  async fishingVerifyShot({ sessionId, shotSeq, fishType, betPerShot }) {
    const round = getRound(sessionId)
    const recorded = round?.shots?.[String(shotSeq)]
    if (!round || !recorded) {
      return {
        sessionId,
        shotSeq: Number(shotSeq),
        fishType,
        betPerShot: Number(betPerShot),
        commitmentValid: false,
        hit: false,
        payout: 0,
        riskControlled: false,
        serverSeed: round?.serverSeed ?? null,
        serverSeedHash: round ? await commit(round.serverSeed) : null,
        clientSeed: round?.clientSeed ?? null,
        message: '查無此對局或該發紀錄，無法驗證。',
      }
    }
    const commitmentValid = true
    return {
      sessionId,
      shotSeq: Number(shotSeq),
      fishType: recorded.fishType,
      betPerShot: recorded.betPerShot,
      commitmentValid,
      hit: recorded.captured,
      payout: recorded.payout,
      riskControlled: false,
      serverSeed: round.serverSeed,
      serverSeedHash: await commit(round.serverSeed),
      clientSeed: round.clientSeed,
      message: '承諾相符；本機重放與紀錄一致。',
    }
  },
}
