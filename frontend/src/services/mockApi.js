// 玩法契約單一來源（Phase 5）：表格數值一律 import repo 根 contracts/*.json，與後端 enum/常數的
// 相等性由 game-service 的 ContractParityTest 守門（漂移＝CI 紅燈）。演算「邏輯」（補牌流程、
// pCapture 反推、兩階賠付評估）仍鏡像後端程式碼（AGENTS 雷區 14）。
import slotPaytableContract from '../../../contracts/slot-paytable.json'
import baccaratRulesContract from '../../../contracts/baccarat-rules.json'
import fishingSpeciesContract from '../../../contracts/fishing-species.json'
import fishingCombatContract from '../../../contracts/fishing-combat.json'
import shopCatalogContract from '../../../contracts/shop-catalog.json'

const DB_KEY = 'lucky-star-mock-db-v1'
const SESSION_KEY = 'lucky-star-session-v1'

// 老虎機賠付表（contracts/slot-paytable.json ↔ 後端 SlotSymbol：權重 + 兩階倍率，權重總和 103）。
// 中線由左到右兩階賠付：三連（三格同符號）派 tripleMultiplier 大獎；
// 左二同（左二格同、第三格不同）派 pairMultiplier 小獎；右二格相同不賠。
// 理論 RTP ≈ 93.5%、命中率 ≈ 30.7%（pᵢ = 權重ᵢ / 103）。
const SLOT_PAYTABLE = slotPaytableContract.symbols.map(
  ({ display, weight, pairMultiplier, tripleMultiplier }) => ({
    symbol: display,
    weight,
    pairMultiplier,
    tripleMultiplier,
  }),
)
const SLOT_TOTAL_WEIGHT = SLOT_PAYTABLE.reduce((sum, entry) => sum + entry.weight, 0)
const SLOT_PAYTABLE_BY_SYMBOL = Object.fromEntries(
  SLOT_PAYTABLE.map((entry) => [entry.symbol, entry])
)

// 捕魚機（血量/傷害模型，ADR-003 / ADR-004）：數值來自 contracts/fishing-combat.json 與
// contracts/fishing-species.json（↔ 後端 FishingCombat / FishSpecies，ContractParityTest 守門）。
const FISHING_TARGET_RTP = fishingCombatContract.targetRtp
// 殘血部分回收率（受傷未死的魚在結算時退還的子彈成本比例＝體感 RTP 地板，ADR-004）
const FISHING_RECOVERY_RATE = fishingCombatContract.recoveryRate
const FISHING_MONEY_TREE_MIN = fishingSpeciesContract.moneyTreeMultiplier.min
const FISHING_MONEY_TREE_MAX = fishingSpeciesContract.moneyTreeMultiplier.max
// HP = multiplier × 此值（後端 FishSpecies.HP_PER_MULTIPLIER）
const FISHING_HP_PER_MULT = fishingSpeciesContract.hpPerMultiplier
// 暴擊（後端 FishingCombat）
const FISHING_CRIT_CHANCE = fishingCombatContract.critChance
const FISHING_CRIT_MULT = fishingCombatContract.critMultiplier
// 各砲台單發基礎傷害（索引 0 不用；銅/銀/金，後端 FishingCombat.CANNON_DAMAGE）
const FISHING_CANNON_DAMAGE = fishingCombatContract.cannonDamage
const FISHING_MIN_BET = 10
const FISHING_MAX_BET = 10000
const FISHING_MIN_BUYIN = 100
const FISHING_MAX_BUYIN = 1000000
const FISH_SPECIES = fishingSpeciesContract.species.map(
  ({ code, displayName, assetId, multiplier, tier, spawnWeight }) => ({
    code,
    name: displayName,
    assetId,
    multiplier,
    tier,
    spawnWeight,
  }),
)

function isFishingBlocker(fishType) {
  return ['BLOCKER_OCTOPUS', 'BLOCKER_STARFISH', 'BLOCKER_TURTLE'].includes(
    String(fishType || '').toUpperCase()
  )
}

function isFishingMiss(fishType) {
  return String(fishType || '').toUpperCase() === 'MISS'
}

function fishHp(fish) {
  return fish.multiplier * FISHING_HP_PER_MULT
}

// 期望擊殺發數 E[N]（DP；對齊後端 FishingCombat.expectedShotsToKill）。
function fishingExpectedShotsToKill(hp, damage) {
  if (hp <= 0) return 0
  const units = Math.ceil(hp / damage)
  const g = new Array(units + 2).fill(0)
  for (let u = units - 1; u >= 0; u--) {
    g[u] = 1 + (1 - FISHING_CRIT_CHANCE) * g[u + 1] + FISHING_CRIT_CHANCE * g[u + 2]
  }
  return g[0]
}

// 捕獲機率 pCapture（反推使 RTP=TARGET_RTP；對齊後端 FishingCombat.pCapture）。
function fishingCapture(fish, cannonLevel) {
  const eN = fishingExpectedShotsToKill(fishHp(fish), FISHING_CANNON_DAMAGE[cannonLevel])
  return Math.min(1, (FISHING_TARGET_RTP * eN) / fish.multiplier)
}

// 殘血部分回收（鏡像後端 FishingCombat.recoveryPayout，ADR-004）：對「受傷但未打死」的魚，
// 按已造成傷害換算的期望耗彈成本退還 RECOVERY_RATE 比例。critFactor 還原暴擊讓每發平均多扣的血。
function fishingCritFactor() {
  return 1 + FISHING_CRIT_CHANCE * (FISHING_CRIT_MULT - 1)
}
function fishingRecoveryPayout(betPerShot, cannonLevel, cumDamage) {
  if (cumDamage <= 0 || betPerShot <= 0) return 0
  const expectedShots = cumDamage / (fishingCritFactor() * FISHING_CANNON_DAMAGE[cannonLevel])
  return Math.floor(FISHING_RECOVERY_RATE * betPerShot * expectedShots)
}

function fishTableView() {
  return FISH_SPECIES.map((fish) => ({
    code: fish.code,
    name: fish.name,
    assetId: fish.assetId,
    multiplier: fish.multiplier,
    hp: fishHp(fish),
    tier: fish.tier,
    spawnWeight: fish.spawnWeight,
  }))
}

function randInt(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1))
}
const baccaratValues = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K']
const transactionLabels = {
  bet: '下注',
  payout: '派彩',
  checkin: '簽到',
  task: '任務',
  gift: '贈送',
  shop: '商城兌換',
}
const DAILY_CHECKIN_REWARD = 100
// 破產補助：餘額低於門檻才可領、固定發放金額（與後端 BankruptcyAidService 一致）
const BANKRUPTCY_AID_THRESHOLD = 100
const BANKRUPTCY_AID_AMOUNT = 1000
const checkInMilestoneBonuses = {
  7: 1000,
  14: 2000,
  21: 3000,
  30: 5000,
}

// 月度「累計」簽到里程碑（鏡像後端 MonthlyRewardService.MILESTONES）：
// 當月累計簽到天數達門檻可手動領取大獎，與連續天數里程碑（上方）獨立。
const MONTHLY_REWARD_MILESTONES = [
  { days: 10, reward: 2000 },
  { days: 20, reward: 5000 },
  { days: 28, reward: 12000 },
]

// 禮品商城目錄（contracts/shop-catalog.json；正式目錄的單一真相在 MySQL shop_items——ADR-006、
// AGENTS 雷區 20）。改 database/mysql/init.sql 的 seed 時同步契約檔。
const SHOP_CATALOG = shopCatalogContract.items

const MOCK_TEST_STAR_COIN_BALANCE = 999999999999

const TEST_ACCOUNT = {
  password: 'test1234',
  player: {
    id: 'test-player',
    username: 'test',
    email: 'test@example.com',
    nickname: '測試玩家',
    avatarUrl: '',
    consecutiveCheckInDays: 0,
    lastCheckInDate: null,
  },
}

function wait(ms = 420) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms)
  })
}

function readJson(key, fallback) {
  try {
    const value = localStorage.getItem(key)
    return value ? JSON.parse(value) : fallback
  } catch {
    return fallback
  }
}

function writeJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value))
}

function createRankRows() {
  const names = [
    'Nova',
    'AceLin',
    'BlackJack',
    'Mika',
    'StarRay',
    'MoonKai',
    'NinaWin',
    'Leo777',
    'Jade',
    'Iris',
  ]

  return Array.from({ length: 100 }, (_, index) => ({
    id: `rank-${index + 1}`,
    name: names[index % names.length] + (index > 9 ? `-${index + 1}` : ''),
    nickname: names[index % names.length] + (index > 9 ? `-${index + 1}` : ''),
    score: 120000 - index * 875 + Math.floor(Math.random() * 300),
    trend: index % 3 === 0 ? '+12%' : index % 3 === 1 ? '+5%' : '-2%',
  }))
}

function createInitialDb() {
  const player = {
    id: 'demo-player',
    username: 'frontend-owner',
    email: 'player@example.com',
    nickname: '前端負責人',
    avatarUrl: '',
    consecutiveCheckInDays: 4,
    lastCheckInDate: null,
  }

  return {
    users: [
      {
        password: 'demo-password',
        player,
      },
      {
        password: TEST_ACCOUNT.password,
        player: { ...TEST_ACCOUNT.player },
      },
    ],
    wallets: {
      [player.id]: {
        balance: MOCK_TEST_STAR_COIN_BALANCE,
        frozenAmount: 0,
      },
      [TEST_ACCOUNT.player.id]: {
        balance: MOCK_TEST_STAR_COIN_BALANCE,
        frozenAmount: 0,
      },
    },
    transactions: {
      [player.id]: [
        makeTransaction('payout', 600, '老虎機派彩', 'settled'),
        makeTransaction('bet', -100, '百家樂下注', 'settled'),
        makeTransaction('task', 10000, '任務獎勵', 'settled'),
      ],
      [TEST_ACCOUNT.player.id]: [makeTransaction('task', 50000, '測試帳號啟動金', 'settled')],
    },
    friends: {
      [player.id]: [
        { id: 'friend-1', username: 'Nova', nickname: 'Nova', balance: 98200, avatarUrl: '' },
        { id: 'friend-2', username: 'AceLin', nickname: 'AceLin', balance: 87400, avatarUrl: '' },
      ],
      [TEST_ACCOUNT.player.id]: [],
    },
    // 後端權威簽到日期（每元素 'yyyy-MM-dd'，台北時區）與月度累計獎勵領取紀錄
    checkinDates: {
      [player.id]: [],
      [TEST_ACCOUNT.player.id]: [],
    },
    monthlyRewardClaims: {
      [player.id]: [],
      [TEST_ACCOUNT.player.id]: [],
    },
    ranks: [
      {
        id: TEST_ACCOUNT.player.id,
        name: TEST_ACCOUNT.player.nickname,
        nickname: TEST_ACCOUNT.player.nickname,
        score: 50000,
        trend: '+0%',
      },
      ...createRankRows(),
    ],
  }
}

function ensureTestAccount(db) {
  let changed = false
  db.users = db.users || []
  db.wallets = db.wallets || {}
  db.transactions = db.transactions || {}
  db.friends = db.friends || {}
  db.ranks = db.ranks || []
  db.checkinDates = db.checkinDates || {}
  db.monthlyRewardClaims = db.monthlyRewardClaims || {}

  let user = db.users.find((item) => item.player?.username === TEST_ACCOUNT.player.username)
  if (!user) {
    user = {
      password: TEST_ACCOUNT.password,
      player: { ...TEST_ACCOUNT.player },
    }
    db.users.push(user)
    changed = true
  }

  if (user.password !== TEST_ACCOUNT.password) {
    user.password = TEST_ACCOUNT.password
    changed = true
  }

  user.player = {
    ...TEST_ACCOUNT.player,
    ...user.player,
    username: TEST_ACCOUNT.player.username,
    id: TEST_ACCOUNT.player.id,
  }
  if (!db.wallets[TEST_ACCOUNT.player.id]) {
    db.wallets[TEST_ACCOUNT.player.id] = { balance: MOCK_TEST_STAR_COIN_BALANCE, frozenAmount: 0 }
    changed = true
  }

  if (!db.transactions[TEST_ACCOUNT.player.id]) {
    db.transactions[TEST_ACCOUNT.player.id] = [
      makeTransaction('task', 50000, '測試帳號啟動金', 'settled'),
    ]
    changed = true
  }

  if (!db.friends[TEST_ACCOUNT.player.id]) {
    db.friends[TEST_ACCOUNT.player.id] = []
    changed = true
  }

  if (!db.ranks.some((row) => row.id === TEST_ACCOUNT.player.id)) {
    db.ranks.unshift({
      id: TEST_ACCOUNT.player.id,
      name: TEST_ACCOUNT.player.nickname,
      nickname: TEST_ACCOUNT.player.nickname,
      score: 50000,
      trend: '+0%',
    })
    changed = true
  }

  return changed
}

function getDb() {
  const existing = readJson(DB_KEY, null)
  if (existing) {
    if (ensureTestAccount(existing)) {
      writeJson(DB_KEY, existing)
    }
    return existing
  }
  const db = createInitialDb()
  writeJson(DB_KEY, db)
  return db
}

function saveDb(db) {
  writeJson(DB_KEY, db)
  return db
}

function makeTransaction(type, amount, title, status = 'settled') {
  const createdAt = new Date().toISOString()
  return {
    id: `TX-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
    type,
    typeLabel: transactionLabels[type] || type,
    amount,
    title,
    status,
    createdAt,
  }
}

function createSession(player) {
  const session = {
    accessToken: `mock-access-${player.id}-${Date.now()}`,
    refreshToken: `mock-refresh-${player.id}-${Date.now()}`,
    expiresIn: 900,
    player,
  }
  writeJson(SESSION_KEY, session)
  localStorage.setItem('accessToken', session.accessToken)
  localStorage.setItem('refreshToken', session.refreshToken)
  return session
}

function currentPlayerId() {
  return readJson(SESSION_KEY, null)?.player?.id || 'demo-player'
}

// 單張牌的百家樂點數（鏡像後端 Card.value()）：A=1、10/J/Q/K=0、其餘為牌面數字。
function cardValue(card) {
  if (card === 'A') return 1
  if (['J', 'Q', 'K', '10'].includes(card)) return 0
  return Number(card)
}

function points(cards) {
  return cards.reduce((sum, card) => sum + cardValue(card), 0) % 10
}

function randomCard() {
  return baccaratValues[Math.floor(Math.random() * baccaratValues.length)]
}

// 百家樂表格數值（contracts/baccarat-rules.json ↔ 後端 BaccaratGameService，ContractParityTest 守門）
const BACCARAT_TIE_PAYOUT_RATIO = baccaratRulesContract.tiePayoutRatio
const BACCARAT_BANKER_COMMISSION_RATE = baccaratRulesContract.bankerCommissionRate
const BANKER_DRAW_TABLE = baccaratRulesContract.bankerDraws

// 莊家補牌（查契約檔補牌表；判定邏輯鏡像後端 BaccaratGameService.bankerDraws）。
// playerThirdValue 為 null 代表閒家未補牌：莊點 ≤ whenPlayerStandsDrawOnMax（5）即補。
function bankerDrawsMock(bankerScore, playerThirdValue) {
  if (playerThirdValue === null) return bankerScore <= BANKER_DRAW_TABLE.whenPlayerStandsDrawOnMax
  return (BANKER_DRAW_TABLE.byBankerScore[String(bankerScore)] || []).includes(playerThirdValue)
}

// 單一押注區派彩（含本金，鏡像後端 BaccaratGameService.payoutFor）。
// 和局：押中和賠 tiePayoutRatio:1（8:1，本金+8 倍）、押莊/閒退回本金（push）；非和局押錯為 0；
// 押中莊扣 bankerCommissionRate（5%）傭金、押中閒 1:1。
function baccaratPayout(area, winner, amount) {
  if (winner === 'tie') {
    if (area === 'tie') return amount * (1 + BACCARAT_TIE_PAYOUT_RATIO)
    return amount // 押莊/閒：和局退回本金（push）
  }
  if (area !== winner) return 0
  if (area === 'banker') return amount * 2 - Math.floor(amount * BACCARAT_BANKER_COMMISSION_RATE)
  return amount * 2 // player 1:1
}

// 發一局百家樂（鏡像後端 BaccaratGameService.play 的補牌流程）。
function dealBaccarat() {
  const player = [randomCard(), randomCard()]
  const banker = [randomCard(), randomCard()]
  let playerScore = points(player)
  let bankerScore = points(banker)
  const playerNatural = playerScore >= 8
  const bankerNatural = bankerScore >= 8

  // 任一方天牌（8/9）→ 雙方皆不補牌
  if (!playerNatural && !bankerNatural) {
    let playerThirdValue = null
    // 閒家：0~5 補牌，6~7 停牌
    if (playerScore <= 5) {
      const third = randomCard()
      player.push(third)
      playerThirdValue = cardValue(third)
      playerScore = points(player)
    }
    // 莊家：依補牌表
    if (bankerDrawsMock(bankerScore, playerThirdValue)) {
      banker.push(randomCard())
      bankerScore = points(banker)
    }
  }

  const winner =
    playerScore === bankerScore ? 'tie' : playerScore > bankerScore ? 'player' : 'banker'
  return { player, banker, playerScore, bankerScore, winner }
}

// 加權抽樣一個符號（鏡像後端 SlotSymbol.fromWeightedIndex 的累積權重對應）。
function pickSlotSymbol() {
  let cursor = Math.floor(Math.random() * SLOT_TOTAL_WEIGHT)
  for (const entry of SLOT_PAYTABLE) {
    if (cursor < entry.weight) return entry.symbol
    cursor -= entry.weight
  }
  return SLOT_PAYTABLE[SLOT_PAYTABLE.length - 1].symbol // 理論不可達
}

// 3x3 盤面：每格獨立加權抽樣（與後端逐格抽樣分布一致）。
function randomSlotGrid() {
  return Array.from({ length: 3 }, () => Array.from({ length: 3 }, () => pickSlotSymbol()))
}

// 中線兩階評估（鏡像後端 SlotMachine.evaluate）：
// 三連 → tripleMultiplier + 中線三格；左二同（a==b 且 c≠a）→ pairMultiplier + 左二格；否則未中。
function evaluateSlotLine(grid) {
  const [a, b, c] = grid[1]
  if (a === b && b === c) {
    return {
      multiplier: SLOT_PAYTABLE_BY_SYMBOL[a].tripleMultiplier,
      winningCells: [
        [1, 0],
        [1, 1],
        [1, 2],
      ],
    }
  }
  if (a === b) {
    return {
      multiplier: SLOT_PAYTABLE_BY_SYMBOL[a].pairMultiplier,
      winningCells: [
        [1, 0],
        [1, 1],
      ],
    }
  }
  return { multiplier: 0, winningCells: [] }
}

function applyWalletChange(db, playerId, amount, type, title) {
  const wallet = db.wallets[playerId] || { balance: 0, frozenAmount: 0 }
  wallet.balance = Math.max(wallet.balance + amount, 0)
  db.wallets[playerId] = wallet
  db.transactions[playerId] = [
    makeTransaction(type, amount, title),
    ...(db.transactions[playerId] || []),
  ]
  return wallet
}

// 記錄一筆遊戲紀錄/注單（鏡像後端 game_rounds：流水號、局號、毫秒下注/派彩時間、餘額變化）。
// 預設保留近 200 筆，避免 localStorage 無限膨脹。
function recordGameRound(db, playerId, record) {
  db.gameRounds = db.gameRounds || {}
  const list = db.gameRounds[playerId] || []
  list.unshift(record)
  db.gameRounds[playerId] = list.slice(0, 200)
}

function calculateCheckInReward(days) {
  return DAILY_CHECKIN_REWARD + (checkInMilestoneBonuses[days] || 0)
}

// 台北（UTC+8）日界的 yyyy-MM-dd（鏡像後端 LocalDate.now(Asia/Taipei)）。
// 後端簽到/結算一律以台北時區判日，mock 必須一致，否則跨時區日界會與後端分歧。
function getTaipeiDateKey(date = new Date()) {
  return new Date(date.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

export function readStoredSession() {
  return readJson(SESSION_KEY, null)
}

export const mockApi = {
  async login({ username, password }) {
    await wait()
    const db = getDb()
    const user = db.users.find((item) => item.player.username === username)
    if (!user || user.password !== password) {
      throw new Error('帳號或密碼不正確')
    }
    return createSession(user.player)
  },

  async register({ username, password, nickname, email }) {
    await wait(520)
    const db = getDb()
    if (db.users.some((item) => item.player.username === username)) {
      throw new Error('此帳號已被註冊')
    }

    const player = {
      id: `player-${Date.now()}`,
      username,
      email,
      nickname,
      avatarUrl: '',
      consecutiveCheckInDays: 0,
      lastCheckInDate: null,
    }

    db.users.push({ password, player })
    db.wallets[player.id] = { balance: MOCK_TEST_STAR_COIN_BALANCE, frozenAmount: 0 }
    db.transactions[player.id] = [makeTransaction('task', 30000, '新手啟動金')]
    db.friends[player.id] = []
    db.ranks.push({ id: player.id, name: nickname, nickname, score: 30000, trend: '+0%' })
    saveDb(db)
    return createSession(player)
  },

  async logout() {
    await wait(180)
    localStorage.removeItem(SESSION_KEY)
    localStorage.removeItem('accessToken')
    localStorage.removeItem('refreshToken')
    return true
  },

  async getProfile() {
    await wait(260)
    const db = getDb()
    return db.users.find((item) => item.player.id === currentPlayerId())?.player || null
  },

  async updateProfile(profile) {
    await wait()
    const db = getDb()
    const user = db.users.find((item) => item.player.id === currentPlayerId())
    if (!user) throw new Error('找不到玩家資料')
    user.player = { ...user.player, ...profile }
    saveDb(db)
    const session = readStoredSession()
    if (session) writeJson(SESSION_KEY, { ...session, player: user.player })
    return user.player
  },

  async getWallet() {
    await wait(240)
    const db = getDb()
    const playerId = currentPlayerId()
    db.wallets[playerId] = {
      ...(db.wallets[playerId] || { frozenAmount: 0 }),
      balance: MOCK_TEST_STAR_COIN_BALANCE,
    }
    saveDb(db)
    return db.wallets[playerId]
  },

  async checkIn() {
    await wait()
    const db = getDb()
    const playerId = currentPlayerId()
    const user = db.users.find((item) => item.player.id === playerId)
    const today = getTaipeiDateKey()
    if (user?.player.lastCheckInDate === today) {
      throw new Error('今天已經簽到過了')
    }

    // 連續天數：上次簽到非「台北昨日」則重置為 1（鏡像後端 CheckinService 的缺日重置）
    const yesterday = getTaipeiDateKey(new Date(Date.now() - 24 * 60 * 60 * 1000))
    const days =
      user?.player.lastCheckInDate === yesterday
        ? (user?.player.consecutiveCheckInDays || 0) + 1
        : 1
    const reward = calculateCheckInReward(days)
    user.player.consecutiveCheckInDays = days
    user.player.lastCheckInDate = today

    // 後端權威：把當日加入 checkinDates（供月曆/月度累計），去重後升冪
    const dates = db.checkinDates[playerId] || []
    if (!dates.includes(today)) dates.push(today)
    dates.sort()
    db.checkinDates[playerId] = dates

    const wallet = applyWalletChange(db, playerId, reward, 'checkin', `每日簽到第 ${days} 天`)
    saveDb(db)
    return { wallet, player: user.player, reward, consecutiveDays: days }
  },

  // GET /api/v1/wallet/checkin/status 的 mock（鏡像後端 MonthlyRewardService.getStatus）。
  // 回傳與後端 CheckinStatusResponse 同形：月曆已簽日期、本月累計天數、連續天數、月度里程碑旗標。
  async getCheckInStatus(month) {
    await wait(200)
    const db = getDb()
    const playerId = currentPlayerId()
    const user = db.users.find((item) => item.player.id === playerId)
    const currentMonth = getTaipeiDateKey().slice(0, 7)
    const targetMonth = /^\d{4}-\d{2}$/.test(month || '') ? month : currentMonth
    const isCurrentMonth = targetMonth === currentMonth

    const allDates = db.checkinDates[playerId] || []
    const signedDates = allDates.filter((d) => d.slice(0, 7) === targetMonth).sort()
    const monthCheckinDays = signedDates.length

    const today = getTaipeiDateKey()
    const yesterday = getTaipeiDateKey(new Date(Date.now() - 24 * 60 * 60 * 1000))
    const last = user?.player.lastCheckInDate
    const checkedInToday = last === today
    const consecutiveDays =
      last === today || last === yesterday ? user?.player.consecutiveCheckInDays || 0 : 0

    const claims = db.monthlyRewardClaims[playerId] || []
    const milestones = MONTHLY_REWARD_MILESTONES.map(({ days, reward }) => {
      const reached = monthCheckinDays >= days
      const claimed = claims.some((c) => c.rewardMonth === targetMonth && c.milestoneDays === days)
      return {
        milestoneDays: days,
        rewardAmount: reward,
        reached,
        claimed,
        claimable: reached && !claimed && isCurrentMonth,
      }
    })

    return {
      month: targetMonth,
      signedDates,
      monthCheckinDays,
      consecutiveDays,
      checkedInToday,
      milestones,
    }
  },

  // POST /api/v1/wallet/checkin/monthly-reward 的 mock（鏡像後端 MonthlyRewardService.claimMonthlyReward）。
  // 僅限台北當月；達標未領才可領，重複領/未達標/無效里程碑皆 throw。
  async claimMonthlyReward(milestoneDays) {
    await wait()
    const db = getDb()
    const playerId = currentPlayerId()
    const def = MONTHLY_REWARD_MILESTONES.find((m) => m.days === milestoneDays)
    if (!def) throw new Error('無效的簽到里程碑')

    const month = getTaipeiDateKey().slice(0, 7)
    const allDates = db.checkinDates[playerId] || []
    const monthCheckinDays = allDates.filter((d) => d.slice(0, 7) === month).length
    if (monthCheckinDays < milestoneDays) {
      throw new Error(`本月累計簽到未達 ${milestoneDays} 天，尚不可領取`)
    }

    const claims = db.monthlyRewardClaims[playerId] || []
    if (claims.some((c) => c.rewardMonth === month && c.milestoneDays === milestoneDays)) {
      throw new Error('本月此里程碑獎勵已領取')
    }

    claims.push({ rewardMonth: month, milestoneDays, rewardAmount: def.reward })
    db.monthlyRewardClaims[playerId] = claims
    const wallet = applyWalletChange(db, playerId, def.reward, 'checkin', '每月簽到獎勵')
    saveDb(db)
    return { reward: def.reward, milestoneDays, monthCheckinDays, wallet }
  },

  // 破產補助（對應後端 POST /api/v1/wallet/bankruptcy-aid）：
  // 餘額低於門檻（100）且當日尚未領取才可領，固定發放 1000 星幣，每天一次。
  async claimBankruptcyAid() {
    await wait()
    const db = getDb()
    const playerId = currentPlayerId()
    const user = db.users.find((item) => item.player.id === playerId)
    const wallet = db.wallets[playerId] || { balance: 0, frozenAmount: 0 }
    const balanceBefore = wallet.balance
    if (balanceBefore >= BANKRUPTCY_AID_THRESHOLD) {
      throw new Error('餘額未低於門檻（100 星幣），尚不符合破產補助資格')
    }
    const today = new Date().toISOString().slice(0, 10)
    if (user?.player.lastBankruptcyAidDate === today) {
      throw new Error('今日已領取過破產補助')
    }
    if (user) user.player.lastBankruptcyAidDate = today
    const after = applyWalletChange(db, playerId, BANKRUPTCY_AID_AMOUNT, 'task', '破產補助金')
    saveDb(db)
    return {
      amount: BANKRUPTCY_AID_AMOUNT,
      balanceBefore,
      balanceAfter: after.balance,
      wallet: after,
    }
  },

  async getTransactions({
    type = 'all',
    startDate = '',
    endDate = '',
    page = 1,
    pageSize = 8,
  } = {}) {
    await wait(280)
    const db = getDb()
    const rows = db.transactions[currentPlayerId()] || []
    const filtered = rows.filter((row) => {
      const date = row.createdAt.slice(0, 10)
      const matchType = type === 'all' || row.type === type
      const afterStart = !startDate || date >= startDate
      const beforeEnd = !endDate || date <= endDate
      return matchType && afterStart && beforeEnd
    })
    const start = (page - 1) * pageSize
    return {
      items: filtered.slice(start, start + pageSize),
      total: filtered.length,
      page,
      pageSize,
    }
  },

  // 遊戲紀錄/注單分頁查詢（鏡像後端 GET /api/v1/game/history）。
  // gameType：'all' / 'SLOT' / 'BACCARAT' / 'FISHING'。回傳形狀 { items, total, page, pageSize }。
  async getGameHistory({ gameType = 'all', page = 1, pageSize = 10 } = {}) {
    await wait(260)
    const db = getDb()
    const rows = (db.gameRounds || {})[currentPlayerId()] || []
    const filtered = rows.filter((row) => gameType === 'all' || row.gameType === gameType)
    const start = (page - 1) * pageSize
    return {
      items: filtered.slice(start, start + pageSize),
      total: filtered.length,
      page,
      pageSize,
    }
  },

  async spinSlot({ bet }) {
    await wait(900)
    const db = getDb()
    const playerId = currentPlayerId()
    const wallet = db.wallets[playerId]
    if (!wallet || wallet.balance < bet) throw new Error('星幣餘額不足')

    const balanceBefore = wallet.balance
    const betAt = new Date().toISOString()
    applyWalletChange(db, playerId, -bet, 'bet', '老虎機下注')

    const grid = randomSlotGrid()
    const { multiplier, winningCells } = evaluateSlotLine(grid)
    const payout = bet * multiplier // 含本金返還；左二同最低 1x 為退本金（push / LDW）
    if (payout) applyWalletChange(db, playerId, payout, 'payout', '老虎機派彩')

    const roundId = `SLOT-${Date.now()}`
    recordGameRound(db, playerId, {
      roundId,
      gameType: 'SLOT',
      nonce: 0,
      betAmount: bet,
      winAmount: payout,
      profit: payout - bet,
      balanceBefore,
      balanceAfter: db.wallets[playerId].balance,
      betAt,
      settledAt: new Date().toISOString(),
      status: 'SETTLED',
      resultData: JSON.stringify({ grid, multiplier, payout, winningCells }),
    })
    saveDb(db)

    return {
      roundId,
      game: 'slot',
      grid,
      bet,
      multiplier,
      payout,
      winningCells,
      wallet: db.wallets[playerId],
    }
  },

  async baccaratBet({ area, amount }) {
    await wait(880)
    const db = getDb()
    const playerId = currentPlayerId()
    const wallet = db.wallets[playerId]
    if (!wallet || wallet.balance < amount) throw new Error('星幣餘額不足')

    const balanceBefore = wallet.balance
    const betAt = new Date().toISOString()
    applyWalletChange(db, playerId, -amount, 'bet', `百家樂下注 ${area}`)
    const {
      player: playerCards,
      banker: bankerCards,
      playerScore: playerPoints,
      bankerScore: bankerPoints,
      winner,
    } = dealBaccarat()
    const payout = baccaratPayout(area, winner, amount)
    if (payout) applyWalletChange(db, playerId, payout, 'payout', '百家樂派彩')
    const rebate = Math.max(1, Math.floor(amount * 0.005))
    applyWalletChange(db, playerId, rebate, 'payout', '百家樂反水')

    const roundId = `BAC-${Date.now()}`
    // 後端 game_rounds.win_amount = 總派彩 + 反水；此處對齊。
    const winAmount = payout + rebate
    recordGameRound(db, playerId, {
      roundId,
      gameType: 'BACCARAT',
      nonce: 0,
      betAmount: amount,
      winAmount,
      profit: winAmount - amount,
      balanceBefore,
      balanceAfter: db.wallets[playerId].balance,
      betAt,
      settledAt: new Date().toISOString(),
      status: 'SETTLED',
      resultData: JSON.stringify({ area, winner, payout, rebate, playerPoints, bankerPoints }),
    })
    saveDb(db)

    return {
      roundId,
      game: 'baccarat',
      area,
      amount,
      winner,
      payout,
      rebate,
      playerCards,
      bankerCards,
      playerPoints,
      bankerPoints,
      wallet: db.wallets[playerId],
    }
  },

  async getRank() {
    await wait(260)
    const db = getDb()
    const playerId = currentPlayerId()
    const player = db.users.find((item) => item.player.id === playerId)?.player
    const rows = [...db.ranks].sort((a, b) => b.score - a.score).slice(0, 100)
    const myIndex = rows.findIndex((row) => row.id === playerId)
    const friendNames = new Set((db.friends[playerId] || []).map((friend) => friend.nickname))
    return {
      globalRank: rows,
      friendRank: rows.filter((row) => friendNames.has(row.nickname)).slice(0, 20),
      myGlobalRank: {
        rank: myIndex >= 0 ? myIndex + 1 : rows.length,
        nickname: player?.nickname || 'Player',
        score: db.wallets[playerId]?.balance || 0,
      },
    }
  },

  async getFriends() {
    await wait(240)
    const db = getDb()
    return db.friends[currentPlayerId()] || []
  },

  async addFriend(username) {
    await wait()
    const db = getDb()
    const playerId = currentPlayerId()
    const existing = db.friends[playerId] || []
    if (existing.some((friend) => friend.username === username)) throw new Error('已經是好友')
    const user = db.users.find((item) => item.player.username === username)
    const friend = user?.player || {
      id: `friend-${Date.now()}`,
      username,
      nickname: username,
      balance: Math.floor(30000 + Math.random() * 70000),
      avatarUrl: '',
    }
    db.friends[playerId] = [...existing, friend]
    saveDb(db)
    return db.friends[playerId]
  },

  async removeFriend(friendId) {
    await wait(260)
    const db = getDb()
    const playerId = currentPlayerId()
    db.friends[playerId] = (db.friends[playerId] || []).filter((friend) => friend.id !== friendId)
    saveDb(db)
    return db.friends[playerId]
  },

  async giftCoins({ friendId, amount }) {
    await wait()
    const db = getDb()
    const playerId = currentPlayerId()
    const wallet = db.wallets[playerId]
    if (!wallet || wallet.balance < amount) throw new Error('星幣餘額不足')
    const friend = (db.friends[playerId] || []).find((item) => item.id === friendId)
    applyWalletChange(db, playerId, -amount, 'gift', `贈送星幣給 ${friend?.nickname || '好友'}`)
    saveDb(db)
    return { wallet: db.wallets[playerId], friends: db.friends[playerId] || [] }
  },

  // ---- 禮品商城（鏡像後端 wallet-service shop 模組，ADR-006）----

  // 目錄：上架商品（鏡像後端 GET /api/v1/wallet/shop/catalog）。
  async getShopCatalog() {
    await wait(200)
    return SHOP_CATALOG.map((item) => ({ ...item }))
  },

  // 兌換禮品：依 itemCode 查價，以星幣扣款（負數 amount）並寫一筆「商城兌換」交易，物品收進背包。
  async redeemShopItem({ itemCode }) {
    await wait()
    const db = getDb()
    const playerId = currentPlayerId()
    const item = SHOP_CATALOG.find((i) => i.itemCode === itemCode)
    if (!item) throw new Error('商品不存在')
    const wallet = db.wallets[playerId]
    if (!wallet || wallet.balance < item.cost) throw new Error('星幣不足')
    applyWalletChange(db, playerId, -item.cost, 'shop', `商城兌換－${item.name}`)
    db.inventory = db.inventory || {}
    const record = {
      id: `INV-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
      itemCode: item.itemCode,
      title: item.name,
      cost: item.cost,
      redeemedAt: new Date().toISOString(),
    }
    db.inventory[playerId] = [record, ...(db.inventory[playerId] || [])]
    saveDb(db)
    return { wallet: db.wallets[playerId], item: record }
  },

  // 取得玩家背包（兌換到的禮品，新到舊；鏡像後端 GET /api/v1/wallet/shop/inventory）。
  async getInventory() {
    await wait(220)
    const db = getDb()
    return (db.inventory || {})[currentPlayerId()] || []
  },

  // ---- 捕魚機（buy-in 制 + 局內餘額 + 批次結算；對齊 game-service fishing 模組） ----

  async fishingActive() {
    await wait(200)
    const db = getDb()
    const session = (db.fishingSessions || {})[currentPlayerId()]
    if (!session) return null
    // 引擎 remount 後 idSeq 從 0 重置，舊 fishDamage 的 key 會碰撞到新魚 id，
    // 導致新魚繼承舊傷害（初次命中 hpRemaining 異常偏低或直接一擊即死）。
    session.fishDamage = {}
    saveDb(db)
    return {
      sessionId: session.sessionId,
      roomId: `solo-${session.sessionId}`,
      seatIndex: 0,
      cannonLevel: session.cannonLevel,
      betPerShot: session.betPerShot,
      buyIn: session.buyIn,
      sessionBalance: session.sessionBalance,
      totalShots: session.totalShots,
      lastShotSeq: session.lastShotSeq,
      serverSeedHash: session.serverSeedHash,
      clientSeed: session.clientSeed,
      resumed: true,
      wallet: null,
      fishTable: fishTableView(),
    }
  },

  async fishingStart({ buyIn, cannonLevel = 1, betPerShot = 10, clientSeed }) {
    await wait(420)
    const db = getDb()
    const playerId = currentPlayerId()
    db.fishingSessions = db.fishingSessions || {}

    const existing = db.fishingSessions[playerId]
    if (existing) {
      // 已有進行中場次：續玩、不重複扣款（比照後端 resumed）。
      // 同 fishingActive()：引擎 remount 後 idSeq 從 0 重置，舊 fishDamage 的 key
      // 會碰撞到新魚 id，導致新魚繼承舊傷害（初擊即死），故一併歸零。
      existing.fishDamage = {}
      saveDb(db)
      return {
        sessionId: existing.sessionId,
        roomId: `solo-${existing.sessionId}`,
        seatIndex: 0,
        cannonLevel: existing.cannonLevel,
        betPerShot: existing.betPerShot,
        buyIn: existing.buyIn,
        sessionBalance: existing.sessionBalance,
        totalShots: existing.totalShots,
        lastShotSeq: existing.lastShotSeq,
        serverSeedHash: existing.serverSeedHash,
        clientSeed: existing.clientSeed,
        resumed: true,
        wallet: db.wallets[playerId],
        fishTable: fishTableView(),
      }
    }

    const startBuyIn = Number(buyIn)
    const startBet = Number(betPerShot)
    const startCannon = Number(cannonLevel)
    if (!Number.isInteger(startBet) || startBet < FISHING_MIN_BET || startBet > FISHING_MAX_BET) {
      throw new Error(`子彈面額需介於 ${FISHING_MIN_BET}~${FISHING_MAX_BET} 星幣`)
    }
    if (!Number.isInteger(startBuyIn) || startBuyIn < FISHING_MIN_BUYIN || startBuyIn > FISHING_MAX_BUYIN) {
      throw new Error(`入場金額需介於 ${FISHING_MIN_BUYIN}~${FISHING_MAX_BUYIN} 星幣`)
    }
    if (!Number.isInteger(startCannon) || startCannon < 1 || startCannon > 3) {
      throw new Error('cannonLevel must be between 1 and 3')
    }

    const wallet = db.wallets[playerId]
    if (!wallet || wallet.balance < startBuyIn) throw new Error('星幣餘額不足')

    const balanceBefore = wallet.balance
    applyWalletChange(db, playerId, -startBuyIn, 'bet', '捕魚機 buy-in')
    const sessionId = `FISH-${Date.now()}`
    db.fishingSessions[playerId] = {
      sessionId,
      cannonLevel: startCannon,
      betPerShot: startBet,
      buyIn: startBuyIn,
      balanceBefore,
      createdAt: new Date().toISOString(),
      sessionBalance: startBuyIn,
      totalShots: 0,
      totalBet: 0,
      totalPayout: 0,
      lastShotSeq: 0,
      clientSeed: clientSeed || `mock-client-${Date.now()}`,
      serverSeedHash: `mock-hash-${Math.random().toString(36).slice(2, 10)}`,
    }
    saveDb(db)

    return {
      sessionId,
      roomId: `solo-${sessionId}`,
      seatIndex: 0,
      cannonLevel: startCannon,
      betPerShot: startBet,
      buyIn: startBuyIn,
      sessionBalance: startBuyIn,
      totalShots: 0,
      lastShotSeq: 0,
      serverSeedHash: db.fishingSessions[playerId].serverSeedHash,
      clientSeed: db.fishingSessions[playerId].clientSeed,
      resumed: false,
      wallet: db.wallets[playerId],
      fishTable: fishTableView(),
    }
  },

  async fishingShots({ sessionId, shots }) {
    await wait(160)
    const db = getDb()
    const playerId = currentPlayerId()
    const session = (db.fishingSessions || {})[playerId]
    if (!session || session.sessionId !== sessionId) throw new Error('場次不存在或已結束')

    // 鏡像後端 FishingService.validateBatch（ADR-004）：每發 betPerShot 必須等於進場選定的
    // 固定注額，否則整批拒絕——勿放寬，放寬會讓 mock 與真 API 行為分歧（雷區 14）。
    if (!Array.isArray(shots) || shots.length === 0) throw new Error('shots 不可為空')
    if (shots.length > 30) throw new Error('單批最多 30 發')
    let previousSeq = Number(session.lastShotSeq || 0)
    for (const shot of shots) {
      const bet = Number(shot.betPerShot)
      const cannonLevel =
        shot.cannonLevel == null ? Number(session.cannonLevel || 1) : Number(shot.cannonLevel)
      if (!Number.isInteger(bet) || bet < FISHING_MIN_BET || bet > FISHING_MAX_BET)
        throw new Error(`betPerShot must be between ${FISHING_MIN_BET} and ${FISHING_MAX_BET}`)
      if (bet !== Number(session.betPerShot))
        throw new Error('betPerShot must equal the session betPerShot')
      if (!Number.isInteger(cannonLevel) || cannonLevel < 1 || cannonLevel > 3)
        throw new Error('cannonLevel must be between 1 and 3')
      if (cannonLevel !== Number(session.cannonLevel))
        throw new Error('cannonLevel must equal the session cannonLevel')
      if (Number(shot.shotSeq) <= previousSeq) throw new Error('shotSeq 必須遞增')
      previousSeq = Number(shot.shotSeq)
    }
    session.fishDamage = session.fishDamage || {}
    const results = []
    for (const shot of shots) {
      const requestedFishType = String(shot.fishType || '').trim().toUpperCase()
      const fish = FISH_SPECIES.find((item) => item.code === requestedFishType)
      const blocker = isFishingBlocker(requestedFishType)
      const miss = isFishingMiss(requestedFishType)
      const bet = Number(shot.betPerShot)
      const cannonLevel = Number(shot.cannonLevel || session.cannonLevel || 1)
      // 局內餘額不足：該發（含其後同批）整批不受理（比照後端）。
      if (
        (!fish && !blocker && !miss) ||
        !Number.isInteger(bet) ||
        bet <= 0 ||
        ![1, 2, 3].includes(cannonLevel) ||
        session.sessionBalance < bet
      ) {
        results.push({
          shotSeq: shot.shotSeq,
          accepted: false,
          hit: false,
          crit: false,
          damage: 0,
          hpRemaining: 0,
          killed: false,
          captured: false,
          payout: 0,
          sessionBalance: session.sessionBalance,
        })
        continue
      }
      session.sessionBalance -= bet
      session.totalBet += bet
      session.totalShots += 1
      session.lastShotSeq = Math.max(session.lastShotSeq, Number(shot.shotSeq))
      if (miss) {
        session.shotResults = session.shotResults || {}
        session.shotResults[String(shot.shotSeq)] = {
          fishType: 'MISS',
          betPerShot: bet,
          cannonLevel,
          crit: false,
          damage: 0,
          killed: false,
          captured: false,
          payout: 0,
        }
        results.push({
          shotSeq: shot.shotSeq,
          accepted: true,
          hit: false,
          crit: false,
          damage: 0,
          hpRemaining: 0,
          killed: false,
          captured: false,
          payout: 0,
          sessionBalance: session.sessionBalance,
        })
        continue
      }

      if (blocker) {
        session.shotResults = session.shotResults || {}
        session.shotResults[String(shot.shotSeq)] = {
          fishType: requestedFishType,
          betPerShot: bet,
          cannonLevel,
          crit: false,
          damage: 0,
          killed: false,
          captured: false,
          payout: 0,
        }
        results.push({
          shotSeq: shot.shotSeq,
          accepted: true,
          hit: true,
          crit: false,
          damage: 0,
          hpRemaining: 0,
          killed: false,
          captured: false,
          payout: 0,
          sessionBalance: session.sessionBalance,
        })
        continue
      }

      // 血量/傷害模型：累積傷害 → 致命一擊擲捕獲（鏡像後端 FishingCombat）。
      const instanceId = shot.fishInstanceId || `seq-${shot.shotSeq}`
      const hp = fishHp(fish)
      const damageBefore = session.fishDamage[instanceId] || 0
      const crit = Math.random() < FISHING_CRIT_CHANCE
      const damage = FISHING_CANNON_DAMAGE[cannonLevel] * (crit ? FISHING_CRIT_MULT : 1)
      const after = damageBefore + damage
      const killed = after >= hp
      let captured = false
      let payout = 0
      let hpRemaining = 0
      if (!killed) {
        hpRemaining = hp - after
        session.fishDamage[instanceId] = after
        // 殘血回收不在這裡逐發算：fishingRecoveryPayout 含 floor，逐發呼叫會侵蝕低注額
        // （單發 10 星幣時有效回收率只剩 0.62、非設計值 0.70）。改在結算時整場算一次。
      } else {
        captured = Math.random() < fishingCapture(fish, cannonLevel)
        if (captured) {
          const factor =
            fish.code === 'MONEY_TREE'
              ? randInt(FISHING_MONEY_TREE_MIN, FISHING_MONEY_TREE_MAX)
              : fish.multiplier
          payout = bet * factor
          session.sessionBalance += payout
          session.totalPayout += payout
        }
        delete session.fishDamage[instanceId]
      }
      // 記錄逐發結果供結算後 verify-shot 重放（mock 無真正 RNG 種子，改以對局存檔回放）。
      session.shotResults = session.shotResults || {}
      session.shotResults[String(shot.shotSeq)] = {
        fishType: fish.code,
        betPerShot: bet,
        cannonLevel,
        crit,
        damage,
        killed,
        captured,
        payout,
      }
      results.push({
        shotSeq: shot.shotSeq,
        accepted: true,
        hit: true,
        crit,
        damage,
        hpRemaining,
        killed,
        captured,
        payout,
        sessionBalance: session.sessionBalance,
      })
    }
    saveDb(db)

    return {
      sessionId,
      results,
      sessionBalance: session.sessionBalance,
      totalShots: session.totalShots,
      lastShotSeq: session.lastShotSeq,
    }
  },

  async fishingTopUp({ sessionId, amount, clientRequestId }) {
    await wait(220)
    const db = getDb()
    const playerId = currentPlayerId()
    const session = (db.fishingSessions || {})[playerId]
    if (!session || session.sessionId !== sessionId) throw new Error('場次不存在或已結束')
    const topUpAmount = Number(amount)
    if (!Number.isInteger(topUpAmount) || topUpAmount < FISHING_MIN_BUYIN || topUpAmount > FISHING_MAX_BUYIN) {
      throw new Error(`top-up amount must be between ${FISHING_MIN_BUYIN} and ${FISHING_MAX_BUYIN}`)
    }
    if (!clientRequestId || !String(clientRequestId).trim()) throw new Error('clientRequestId is required')
    session.topUpRequestIds = session.topUpRequestIds || []
    if (session.topUpRequestIds.includes(clientRequestId)) {
      return {
        sessionId,
        amount: 0,
        buyIn: session.buyIn,
        sessionBalance: session.sessionBalance,
        wallet: db.wallets[playerId],
      }
    }
    const wallet = db.wallets[playerId]
    if (!wallet || wallet.balance < topUpAmount) throw new Error('星幣不足')
    applyWalletChange(db, playerId, -topUpAmount, 'bet', '捕魚機場中加值')
    session.buyIn += topUpAmount
    session.sessionBalance += topUpAmount
    if (clientRequestId) session.topUpRequestIds.push(clientRequestId)
    saveDb(db)
    return {
      sessionId,
      amount: topUpAmount,
      buyIn: session.buyIn,
      sessionBalance: session.sessionBalance,
      wallet: db.wallets[playerId],
    }
  },

  async fishingEnd({ sessionId }) {
    await wait(360)
    const db = getDb()
    const playerId = currentPlayerId()
    const session = (db.fishingSessions || {})[playerId]
    if (!session || session.sessionId !== sessionId) throw new Error('場次不存在或已結束')

    // 殘血部分回收（ADR-004）：fishDamage 只剩「受傷但未打死」的魚（致命一擊後已 delete），
    // 退還 RECOVERY_RATE 比例的子彈成本，折入局內餘額與 totalPayout（鏡像後端 settleInternal）。
    // 先把整場累傷加總、再算一次回收（含 floor）——逐條/逐發各 floor 一次會侵蝕低注額。
    let totalResidualDamage = 0
    for (const dmg of Object.values(session.fishDamage || {})) {
      totalResidualDamage += Number(dmg) || 0
    }
    const residualRecovery = fishingRecoveryPayout(
      session.betPerShot || 0,
      session.cannonLevel || 1,
      totalResidualDamage
    )
    if (residualRecovery > 0) {
      session.sessionBalance += residualRecovery
      session.totalPayout += residualRecovery
      session.fishDamage = {}
    }

    const credited = session.sessionBalance
    if (credited > 0) applyWalletChange(db, playerId, credited, 'payout', '捕魚機結算')

    const serverSeed = `mock-server-seed-${session.sessionId}`
    // 對局存檔（比照後端 game_rounds），供結算後 verify-shot 回放。
    db.fishingRounds = db.fishingRounds || {}
    db.fishingRounds[sessionId] = {
      serverSeed,
      serverSeedHash: session.serverSeedHash,
      clientSeed: session.clientSeed,
      shots: session.shotResults || {},
    }
    // 遊戲紀錄/注單（彙總一場一筆，鏡像後端 fishing buildRound）。
    const balanceBefore = session.balanceBefore ?? null
    const balanceAfter =
      balanceBefore !== null
        ? balanceBefore - session.buyIn + credited
        : db.wallets[playerId].balance
    recordGameRound(db, playerId, {
      roundId: sessionId,
      gameType: 'FISHING',
      nonce: session.lastShotSeq,
      betAmount: session.totalBet,
      winAmount: session.totalPayout,
      profit: session.totalPayout - session.totalBet,
      balanceBefore,
      balanceAfter,
      betAt: session.createdAt ?? null,
      settledAt: new Date().toISOString(),
      status: 'SETTLED',
      resultData: JSON.stringify({
        buyIn: session.buyIn,
        credited,
        totalShots: session.totalShots,
        totalBet: session.totalBet,
        totalPayout: session.totalPayout,
        cannonLevel: session.cannonLevel,
      }),
    })
    delete db.fishingSessions[playerId]
    saveDb(db)

    return {
      sessionId,
      buyIn: session.buyIn,
      totalBet: session.totalBet,
      totalPayout: session.totalPayout,
      totalShots: session.totalShots,
      credited,
      residualRecovery,
      serverSeed,
      serverSeedHash: session.serverSeedHash,
      clientSeed: session.clientSeed,
      wallet: db.wallets[playerId],
    }
  },

  async fishingVerifyShot({ sessionId, shotSeq, fishType, betPerShot }) {
    await wait(200)
    const db = getDb()
    const round = (db.fishingRounds || {})[sessionId]
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
        serverSeed: round?.serverSeed ?? null,
        serverSeedHash: round?.serverSeedHash ?? null,
        clientSeed: round?.clientSeed ?? null,
        message: '查無此對局或該發紀錄，無法驗證。',
      }
    }
    return {
      sessionId,
      shotSeq: Number(shotSeq),
      fishType: recorded.fishType,
      betPerShot: recorded.betPerShot,
      commitmentValid: true,
      hit: !!recorded.captured,
      payout: recorded.payout,
      serverSeed: round.serverSeed,
      serverSeedHash: round.serverSeedHash,
      clientSeed: round.clientSeed,
      message: '承諾相符；mock 重放與紀錄一致。',
    }
  },
}
