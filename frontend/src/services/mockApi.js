const DB_KEY = 'lucky-star-mock-db-v1'
const SESSION_KEY = 'lucky-star-session-v1'

const slotSymbols = ['🍒', '🍋', '🔔', '⭐', '7️⃣']
const MOCK_SLOT_FORCED_WIN_RATE = 0.18
const baccaratValues = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K']
const transactionLabels = {
  bet: '下注',
  payout: '派彩',
  checkin: '簽到',
  task: '任務',
  gift: '贈送',
}
const DAILY_CHECKIN_REWARD = 100
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
}
