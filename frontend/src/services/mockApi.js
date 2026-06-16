const DB_KEY = 'lucky-star-mock-db-v1'
const SESSION_KEY = 'lucky-star-session-v1'

const slotSymbols = ['🍒', '🍋', '🔔', '⭐', '7️⃣']
const MOCK_SLOT_FORCED_WIN_RATE = 0.18

// 捕魚機魚種表（與後端 FishSpecies 對齊）；命中機率 = TARGET_RTP / 倍率。
const FISHING_TARGET_RTP = 0.92
const FISHING_MONEY_TREE_MIN = 10
const FISHING_MONEY_TREE_MAX = 50
const FISH_SPECIES = [
  { code: 'KOI', name: '錦鯉', assetId: 'fish-koi', multiplier: 2 },
  { code: 'GOLDFISH', name: '金魚', assetId: 'fish-goldfish', multiplier: 3 },
  { code: 'LANTERN', name: '燈籠魚', assetId: 'fish-lantern', multiplier: 5 },
  { code: 'PUFFER', name: '河豚', assetId: 'fish-puffer', multiplier: 8 },
  { code: 'ANGELFISH', name: '神仙魚', assetId: 'fish-angelfish', multiplier: 15 },
  { code: 'DEVIL_RAY', name: '魔鬼魚', assetId: 'fish-devil-ray', multiplier: 25 },
  { code: 'GOLD_DRAGON', name: '金龍', assetId: 'fish-gold-dragon', multiplier: 60 },
  { code: 'PIXIU', name: '貔貅', assetId: 'fish-pixiu', multiplier: 88 },
  { code: 'CAISHEN', name: '財神爺', assetId: 'fish-caishen', multiplier: 100 },
  { code: 'DRAGON_KING', name: '龍王', assetId: 'fish-dragon-king', multiplier: 200 },
  { code: 'MONEY_TREE', name: '搖錢樹', assetId: 'fish-money-tree', multiplier: 30 },
]

function fishTableView() {
  return FISH_SPECIES.map((fish) => ({
    code: fish.code,
    name: fish.name,
    assetId: fish.assetId,
    multiplier: fish.multiplier,
    hitProbability: FISHING_TARGET_RTP / fish.multiplier,
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
        balance: 50000,
        frozenAmount: 0,
      },
      [TEST_ACCOUNT.player.id]: {
        balance: 50000,
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
    ranks: [{ id: TEST_ACCOUNT.player.id, name: TEST_ACCOUNT.player.nickname, nickname: TEST_ACCOUNT.player.nickname, score: 50000, trend: '+0%' }, ...createRankRows()],
  }
}

function ensureTestAccount(db) {
  let changed = false
  db.users = db.users || []
  db.wallets = db.wallets || {}
  db.transactions = db.transactions || {}
  db.friends = db.friends || {}
  db.ranks = db.ranks || []

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

  user.player = { ...TEST_ACCOUNT.player, ...user.player, username: TEST_ACCOUNT.player.username, id: TEST_ACCOUNT.player.id }
  if (!db.wallets[TEST_ACCOUNT.player.id]) {
    db.wallets[TEST_ACCOUNT.player.id] = { balance: 50000, frozenAmount: 0 }
    changed = true
  }

  if (!db.transactions[TEST_ACCOUNT.player.id]) {
    db.transactions[TEST_ACCOUNT.player.id] = [makeTransaction('task', 50000, '測試帳號啟動金', 'settled')]
    changed = true
  }

  if (!db.friends[TEST_ACCOUNT.player.id]) {
    db.friends[TEST_ACCOUNT.player.id] = []
    changed = true
  }

  if (!db.ranks.some((row) => row.id === TEST_ACCOUNT.player.id)) {
    db.ranks.unshift({ id: TEST_ACCOUNT.player.id, name: TEST_ACCOUNT.player.nickname, nickname: TEST_ACCOUNT.player.nickname, score: 50000, trend: '+0%' })
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

function points(cards) {
  return cards.reduce((sum, card) => {
    if (card === 'A') return sum + 1
    if (['J', 'Q', 'K', '10'].includes(card)) return sum
    return sum + Number(card)
  }, 0) % 10
}

function randomCard() {
  return baccaratValues[Math.floor(Math.random() * baccaratValues.length)]
}

function randomSlotGrid() {
  return Array.from({ length: 3 }, (_, rowIndex) =>
    Array.from({ length: 3 }, (_, colIndex) => slotSymbols[(rowIndex + colIndex + Math.floor(Math.random() * slotSymbols.length)) % slotSymbols.length])
  )
}

function applyWalletChange(db, playerId, amount, type, title) {
  const wallet = db.wallets[playerId] || { balance: 0, frozenAmount: 0 }
  wallet.balance = Math.max(wallet.balance + amount, 0)
  db.wallets[playerId] = wallet
  db.transactions[playerId] = [makeTransaction(type, amount, title), ...(db.transactions[playerId] || [])]
  return wallet
}

function calculateCheckInReward(days) {
  return DAILY_CHECKIN_REWARD + (checkInMilestoneBonuses[days] || 0)
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
    db.wallets[player.id] = { balance: 30000, frozenAmount: 0 }
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
    return db.wallets[currentPlayerId()] || { balance: 0, frozenAmount: 0 }
  },

  async checkIn() {
    await wait()
    const db = getDb()
    const playerId = currentPlayerId()
    const user = db.users.find((item) => item.player.id === playerId)
    const today = new Date().toISOString().slice(0, 10)
    if (user?.player.lastCheckInDate === today) {
      throw new Error('今天已經簽到過了')
    }

    const days = (user?.player.consecutiveCheckInDays || 0) + 1
    const reward = calculateCheckInReward(days)
    user.player.consecutiveCheckInDays = days
    user.player.lastCheckInDate = today
    const wallet = applyWalletChange(db, playerId, reward, 'checkin', `每日簽到第 ${days} 天`)
    saveDb(db)
    return { wallet, player: user.player, reward, consecutiveDays: days }
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

  async getTransactions({ type = 'all', startDate = '', endDate = '', page = 1, pageSize = 8 } = {}) {
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

  async spinSlot({ bet }) {
    await wait(900)
    const db = getDb()
    const playerId = currentPlayerId()
    const wallet = db.wallets[playerId]
    if (!wallet || wallet.balance < bet) throw new Error('星幣餘額不足')

    applyWalletChange(db, playerId, -bet, 'bet', '老虎機下注')
    const grid = randomSlotGrid()
    const centerSymbol = grid[1][0]
    const isWin = grid[1].every((symbol) => symbol === centerSymbol) || Math.random() < MOCK_SLOT_FORCED_WIN_RATE
    if (isWin) grid[1] = [centerSymbol, centerSymbol, centerSymbol]

    const multiplier = isWin ? [2, 3, 5, 8][Math.floor(Math.random() * 4)] : 0
    const payout = bet * multiplier
    if (payout) applyWalletChange(db, playerId, payout, 'payout', '老虎機派彩')
    saveDb(db)

    return {
      roundId: `SLOT-${Date.now()}`,
      game: 'slot',
      grid,
      bet,
      multiplier,
      payout,
      winningCells: payout ? [[1, 0], [1, 1], [1, 2]] : [],
      wallet: db.wallets[playerId],
    }
  },

  async baccaratBet({ area, amount }) {
    await wait(880)
    const db = getDb()
    const playerId = currentPlayerId()
    const wallet = db.wallets[playerId]
    if (!wallet || wallet.balance < amount) throw new Error('星幣餘額不足')

    applyWalletChange(db, playerId, -amount, 'bet', `百家樂下注 ${area}`)
    const playerCards = [randomCard(), randomCard()]
    const bankerCards = [randomCard(), randomCard()]
    const playerPoints = points(playerCards)
    const bankerPoints = points(bankerCards)
    const winner = playerPoints === bankerPoints ? 'tie' : playerPoints > bankerPoints ? 'player' : 'banker'
    const odds = area === 'tie' ? 8 : area === 'banker' ? 0.95 : 1
    const payout = area === winner ? Math.floor(amount + amount * odds) : 0
    if (payout) applyWalletChange(db, playerId, payout, 'payout', '百家樂派彩')
    saveDb(db)

    return {
      roundId: `BAC-${Date.now()}`,
      game: 'baccarat',
      area,
      amount,
      winner,
      payout,
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

  // ---- 捕魚機（buy-in 制 + 局內餘額 + 批次結算；對齊 game-service fishing 模組） ----

  async fishingActive() {
    await wait(200)
    const db = getDb()
    const session = (db.fishingSessions || {})[currentPlayerId()]
    if (!session) return null
    return {
      sessionId: session.sessionId,
      roomId: `solo-${session.sessionId}`,
      seatIndex: 0,
      cannonLevel: session.cannonLevel,
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

  async fishingStart({ buyIn, cannonLevel = 1, clientSeed }) {
    await wait(420)
    const db = getDb()
    const playerId = currentPlayerId()
    db.fishingSessions = db.fishingSessions || {}

    const existing = db.fishingSessions[playerId]
    if (existing) {
      // 已有進行中場次：續玩、不重複扣款（比照後端 resumed）。
      saveDb(db)
      return {
        sessionId: existing.sessionId,
        roomId: `solo-${existing.sessionId}`,
        seatIndex: 0,
        cannonLevel: existing.cannonLevel,
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

    const wallet = db.wallets[playerId]
    if (!wallet || wallet.balance < buyIn) throw new Error('星幣餘額不足')

    applyWalletChange(db, playerId, -buyIn, 'bet', '捕魚機 buy-in')
    const sessionId = `FISH-${Date.now()}`
    db.fishingSessions[playerId] = {
      sessionId,
      cannonLevel,
      buyIn,
      sessionBalance: buyIn,
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
      cannonLevel,
      buyIn,
      sessionBalance: buyIn,
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

    const results = []
    for (const shot of shots) {
      const fish = FISH_SPECIES.find((item) => item.code === shot.fishType)
      const bet = Number(shot.betPerShot)
      // 局內餘額不足：該發（含其後同批）整批不受理（比照後端）。
      if (!fish || session.sessionBalance < bet) {
        results.push({ shotSeq: shot.shotSeq, accepted: false, hit: false, payout: 0, sessionBalance: session.sessionBalance })
        continue
      }
      session.sessionBalance -= bet
      session.totalBet += bet
      session.totalShots += 1
      session.lastShotSeq = Math.max(session.lastShotSeq, Number(shot.shotSeq))

      const hitProbability = FISHING_TARGET_RTP / fish.multiplier
      const hit = Math.random() < hitProbability
      let payout = 0
      if (hit) {
        const factor = fish.code === 'MONEY_TREE' ? randInt(FISHING_MONEY_TREE_MIN, FISHING_MONEY_TREE_MAX) : fish.multiplier
        payout = bet * factor
        session.sessionBalance += payout
        session.totalPayout += payout
      }
      // 記錄逐發結果供結算後 verify-shot 重放（mock 無真正 RNG 種子，改以對局存檔回放）。
      session.shotResults = session.shotResults || {}
      session.shotResults[String(shot.shotSeq)] = { fishType: fish.code, betPerShot: bet, hit, payout }
      results.push({ shotSeq: shot.shotSeq, accepted: true, hit, payout, sessionBalance: session.sessionBalance })
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

  async fishingEnd({ sessionId }) {
    await wait(360)
    const db = getDb()
    const playerId = currentPlayerId()
    const session = (db.fishingSessions || {})[playerId]
    if (!session || session.sessionId !== sessionId) throw new Error('場次不存在或已結束')

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
    delete db.fishingSessions[playerId]
    saveDb(db)

    return {
      sessionId,
      buyIn: session.buyIn,
      totalBet: session.totalBet,
      totalPayout: session.totalPayout,
      totalShots: session.totalShots,
      credited,
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
      hit: recorded.hit,
      payout: recorded.payout,
      serverSeed: round.serverSeed,
      serverSeedHash: round.serverSeedHash,
      clientSeed: round.clientSeed,
      message: '承諾相符；mock 重放與紀錄一致。',
    }
  },
}
