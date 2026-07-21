# Provably Fair 公平性驗證展示頁 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增一個純前端的公平性驗證展示頁（`/provably-fair`），把「承諾 → 下注 → 開獎 → 揭露 → 驗證」五步驟拆開呈現，每步對應一次真實 API 呼叫；mock 模式下用 Web Crypto 做真正的 SHA-256 密碼學計算，斷網也能演。

**Architecture:** 三層——① `provablyFairMock.js`（純函式，移植後端 `RandomStream` 的 SHA-256 串流，自產可驗證的對局，數值 import `contracts/*.json`）；② `fairnessApi.js`（唯一的真/mock 切換點，形狀對齊後端）；③ React 頁面與元件（`ProvablyFair.jsx` + `components/fairness/*` 純展示元件 + 三個 game panel 各自持有五步驟狀態機）。完全不改後端、不改現有 `mockApi.js` 的三個玩法、不改現有遊戲頁。

**Tech Stack:** React 18（Vite）、Redux Toolkit（僅真實下注後 dispatch `setBalance`）、Web Crypto API（`crypto.subtle.digest` / `crypto.getRandomValues`）、Vitest（單元測試）、既有 `axios` 封裝 `api.js`。

## Global Constraints

以下為 spec 的專案級硬性要求，每個 task 都隱含適用（數值逐字照抄 spec）：

- **誠實性徽章不可移除**：頁面固定顯示模式徽章 `真實後端` / `本機模擬`；`本機模擬` 徽章旁必附說明：「承諾雜湊為真實 SHA-256 計算，但結果比對為同一份前端邏輯重跑，不構成對後端的獨立驗證」。不得為畫面簡潔移除。
- **數值單一來源＝`contracts/*.json`**：`slot-paytable` / `baccarat-rules` / `fishing-species` / `fishing-combat`，與 `mockApi.js` 同源；不得另建一份數值。
- **不改動範圍**：不改 `SlotGame.jsx` / `Baccarat.jsx` / `Fishing.jsx` 的玩法；不改 `mockApi.js` 的 slot/baccarat/fishing 玩法；不新增後端程式碼。
- **mock RNG 全 async**：串流介面 `await stream.nextInt(bound)` / `await stream.nextDouble()`，位元組用罄時「按需」延伸區塊（不預先算固定 N 塊，`nextInt` 拒絕取樣可耗任意位元組）。連帶三個遊戲的 mock 結果推導函式也是 async。
- **RNG 演算法逐位元組對齊後端**（`backend/game-service/.../rng/RandomStream.java`）：承諾 `SHA-256(serverSeed)` 小寫 hex；串流區塊訊息 `serverSeed:clientSeed:nonce:block`（`:` 分隔、block 由 0 遞增、每塊 32 bytes）；`nextDouble()` 取 4 bytes big-endian ÷ 2³²；`nextInt(bound)` 取 4 bytes 以拒絕取樣（`limit = 2³² − 2³² mod bound`，`u ≥ limit` 丟棄重取）消除取模偏差。
- **餘額守門（三鐵則）**：下注/開火送出前 `if (balance < bet) return` 並顯示「星幣不足」，不只靠後端退回。
- **真實模式登入保護**：路由包 `PrivateRoute`（未登入導去 `/member?mode=login`）。
- **繁體中文**：所有面向玩家的文案、Javadoc/註解、CHANGELOG 一律繁體中文（專案慣例）。
- **前端測試指令**：`cd frontend && npm run test`（Vitest，`vitest run`）。單檔：`npx vitest run src/path/to/file.test.js`。

## 後端契約（已存在，本頁只消費，勿改）

| 遊戲 | 承諾/下注 | 開獎/揭露 | 驗證 | 扣款時機 |
|---|---|---|---|---|
| 老虎機 | `POST /api/v1/game/slot/round` `{bet, clientSeed}` → `PrepareRoundResponse{roundId, game, bet, serverSeedHash, clientSeed}`（**不含 serverSeed**） | `POST /api/v1/game/slot/round/{roundId}/settle` → `SpinResponse{roundId, grid, bet, multiplier, payout, winningCells, wallet, serverSeed, serverSeedHash, clientSeed, nonce}` | `GET /api/v1/game/verify/{roundId}?serverSeed=` | **settle 才扣** |
| 百家樂 | `POST /api/v1/game/baccarat/bet` `{player, banker, tie, clientSeed}` → `BaccaratBetResponse{roundId, game, bets, totalBet, serverSeedHash, clientSeed}` | `POST /api/v1/game/baccarat/{roundId}/result` → `BaccaratResultResponse{roundId, playerCards, bankerCards, playerScore, bankerScore, result, bets, payouts, totalBet, totalPayout, rebate, wallet, serverSeed, serverSeedHash, clientSeed, nonce}` | `GET /api/v1/game/verify/{roundId}?serverSeed=` | **bet 就扣** |
| 捕魚機 | `POST /api/v1/game/fishing/session/start` `{buyIn, cannonLevel, betPerShot, clientSeed}`（含 `serverSeedHash`，不含 serverSeed） | `POST /{sessionId}/shots` → `ShotResult{crit,damage,hpRemaining,killed,captured}`；`POST /{sessionId}/end` 揭露 `serverSeed` | `GET /{sessionId}/verify-shot?shotSeq&fishType&betPerShot` → `FishingShotVerifyResponse{commitmentValid, hit, payout, riskControlled, serverSeed, serverSeedHash, clientSeed, message}` | start 扣 buyIn |

共用驗證回應 `VerificationResponse{roundId, gameType, serverSeed, serverSeedHash, clientSeed, nonce, usedProvidedSeed, commitmentValid, resultMatches, valid, recomputed, stored, message}`。`serverSeed` 參數省略＝用對局已揭露值；帶入竄改值＝`usedProvidedSeed=true` 且 `commitmentValid=false`（作弊演示機制）。

## File Structure

**新建**
- `frontend/src/services/provablyFairMock.js` — Web Crypto 密碼學核心 + `RandomStream` 移植 + 三遊戲確定性推導 + verify。純函式，只依賴 `contracts/*.json`，可獨立單測。
- `frontend/src/services/provablyFairMock.test.js` — 承諾向量、確定性、竄改必失敗、`nextInt` 無偏差。
- `frontend/src/services/fairnessApi.js` — 真/mock 切換層，形狀對齊後端。Panel 不知道自己在哪個模式。
- `frontend/src/pages/ProvablyFair.jsx` — 頁面外殼：模式徽章 + 遊戲切換 + 掛載對應 Panel。
- `frontend/src/components/fairness/StepRail.jsx` — 五步驟進度條（純展示）。
- `frontend/src/components/fairness/SeedCard.jsx` — hash/seed 顯示、複製、揭露後雜湊逐字元對照高亮（純展示）。
- `frontend/src/components/fairness/VerdictPanel.jsx` — 三顆燈 + message（純展示）。
- `frontend/src/components/fairness/ResultDiff.jsx` — recomputed vs stored 並排（純展示）。
- `frontend/src/components/fairness/panels/SlotFairPanel.jsx` — 老虎機五步驟狀態機。
- `frontend/src/components/fairness/panels/BaccaratFairPanel.jsx` — 百家樂五步驟狀態機。
- `frontend/src/components/fairness/panels/FishingFairPanel.jsx` — 捕魚機五步驟狀態機。
- `frontend/src/components/fairness/panels/SlotFairPanel.test.jsx` — panel 狀態機推進與錯誤分支（代表性一支）。
- `frontend/src/components/fairness/fairness.css` — 本頁樣式（避免污染全域）。

**修改**
- `frontend/src/App.jsx` — 新增 `/provably-fair` lazy 路由，包 `ProtectedPage`。
- `frontend/src/pages/Lobby.jsx` — 加一張入口卡片導向 `/provably-fair`。
- `CHANGELOG.md` — 最上方新增一筆。

**職責邊界**：`provablyFairMock.js` 不碰 DOM（除 `localStorage` 存對局供 settle/verify 回放）；`fairnessApi.js` 是唯一真/mock 分歧點；`components/fairness/*` 只吃 props；Panel 各自擁有狀態機、不共用狀態；流程狀態用 `useState`（不進 redux），僅真實下注成功後 dispatch 一次 `setBalance`。

---

### Task 1: `provablyFairMock.js` 密碼學核心與 RandomStream 移植

把後端 `RandomStream` 的 SHA-256 串流搬到瀏覽器 Web Crypto。這是全頁的信任根，先獨立做完並用已知向量鎖死。

**Files:**
- Create: `frontend/src/services/provablyFairMock.js`
- Test: `frontend/src/services/provablyFairMock.test.js`

**Interfaces:**
- Produces（本 task 先產出這些，供 Task 2 消費）：
  - `sha256Hex(str: string): Promise<string>` — UTF-8 → SHA-256 小寫 hex。
  - `commit(serverSeed: string): Promise<string>` — `= sha256Hex(serverSeed)`。
  - `randomHex(byteLength: number): string` — `crypto.getRandomValues` 產生 hex。
  - `createStream(serverSeed, clientSeed, nonce): { nextByte, nextDouble, nextInt, nextInts }` — 全 async。
    - `nextByte(): Promise<number>` `[0,256)`
    - `nextDouble(): Promise<number>` `[0,1)`
    - `nextInt(bound: number): Promise<number>` `[0,bound)` 拒絕取樣
    - `nextInts(count, bound): Promise<number[]>`

- [ ] **Step 1: 先寫失敗測試（承諾向量 + 確定性 + nextInt 邊界）**

Create `frontend/src/services/provablyFairMock.test.js`:

```js
import { describe, expect, test } from 'vitest'
import { sha256Hex, commit, createStream } from './provablyFairMock'

describe('provablyFairMock crypto core', () => {
  // 已知向量：SHA-256("abc") = ba7816bf... （FIPS 180-2 範例）
  test('sha256Hex 對照已知向量', async () => {
    expect(await sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
  })

  test('commit = SHA-256(serverSeed)，小寫 hex', async () => {
    const seed = 'deadbeef'
    expect(await commit(seed)).toBe(await sha256Hex(seed))
    expect(await commit(seed)).toMatch(/^[0-9a-f]{64}$/)
  })

  test('同一三元組必產生相同序列（確定性）', async () => {
    const s1 = createStream('server-1', 'client-1', 0)
    const s2 = createStream('server-1', 'client-1', 0)
    const a = await s1.nextInts(10, 103)
    const b = await s2.nextInts(10, 103)
    expect(a).toEqual(b)
  })

  test('不同 nonce 產生不同序列', async () => {
    const a = await createStream('server-1', 'client-1', 0).nextInts(5, 256)
    const b = await createStream('server-1', 'client-1', 1).nextInts(5, 256)
    expect(a).not.toEqual(b)
  })

  test('nextInt 值域落在 [0, bound)', async () => {
    const s = createStream('server-x', 'client-x', 7)
    for (let i = 0; i < 200; i++) {
      const v = await s.nextInt(13)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(13)
    }
  })
})
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `cd frontend && npx vitest run src/services/provablyFairMock.test.js`
Expected: FAIL（`provablyFairMock` 尚未 export 這些函式，或 module not found）。

- [ ] **Step 3: 實作密碼學核心**

Create `frontend/src/services/provablyFairMock.js`（本 task 先只放核心，Task 2 續加）：

```js
// Provably Fair 展示頁專用的本機模擬（方案 A，spec §4）。
// 純函式：以 Web Crypto 完整重現後端 rng/RandomStream 的 SHA-256 串流，
// 自產「真正可用同一支函式重算」的對局。數值來源沿用 contracts/*.json（與 mockApi 同源）。
// 誠實性（spec §4）：mock 的「重算」是前端拿同一支函式再跑一次，必然相符；
// 這不構成對後端的獨立驗證——UI 以徽章＋說明明示。

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
```

> 說明（給實作者）：後端 `nextByte` 用 `(u << 8) | b` 組 32-bit；JS 位元運算是 32-bit **有號**，`<<` 到第 4 個 byte 會變負數。故此處改用 `u * 256 + b`（純算術，結果 < 2³² 落在安全整數範圍），數值等價、無溢位。

- [ ] **Step 4: 執行測試確認通過**

Run: `cd frontend && npx vitest run src/services/provablyFairMock.test.js`
Expected: PASS（5 個測試全綠）。

- [ ] **Step 5: Commit**

```bash
git add frontend/src/services/provablyFairMock.js frontend/src/services/provablyFairMock.test.js
git commit -m "feat(frontend): Provably Fair 展示頁 mock 密碼學核心（Web Crypto 移植 RandomStream）"
```

---

### Task 2: `provablyFairMock.js` 三遊戲確定性推導與 verify

在核心上加三遊戲的「開局→揭露→驗證」推導。數值 import `contracts/*.json`，玩法邏輯鏡像既有 `mockApi.js`（兩階賠付、補牌表、HP/pCapture 模型），但隨機來源改成 Task 1 的確定性串流。對局存 `localStorage` 供 settle/verify 回放。

**Files:**
- Modify: `frontend/src/services/provablyFairMock.js`（續加，接在 Task 1 之後）
- Modify: `frontend/src/services/provablyFairMock.test.js`（加確定性/竄改測試）

**Interfaces:**
- Consumes：Task 1 的 `sha256Hex` / `commit` / `randomHex` / `createStream`。
- Produces（供 Task 3 `fairnessApi.js` 消費，形狀對齊後端）：
  - `slotRound({ bet, clientSeed }): Promise<{ roundId, game:'slot', bet, serverSeedHash, clientSeed }>`（不含 serverSeed）
  - `slotSettle({ roundId }): Promise<{ roundId, game:'slot', grid, bet, multiplier, payout, winningCells, serverSeed, serverSeedHash, clientSeed, nonce }>`
  - `baccaratBet({ player, banker, tie, clientSeed }): Promise<{ roundId, game:'baccarat', bets, totalBet, serverSeedHash, clientSeed }>`
  - `baccaratResult({ roundId }): Promise<{ roundId, playerCards, bankerCards, playerScore, bankerScore, result, bets, payouts, totalBet, totalPayout, rebate, serverSeed, serverSeedHash, clientSeed, nonce }>`
  - `verifyRound({ roundId, serverSeed? }): Promise<VerificationResponse 形狀>`（slot/baccarat 共用）
  - `fishingStart({ buyIn, cannonLevel, betPerShot, clientSeed }): Promise<{ sessionId, serverSeedHash, clientSeed, cannonLevel, betPerShot, buyIn }>`
  - `fishingShots({ sessionId, shots }): Promise<{ sessionId, results: ShotResult[] }>`（`ShotResult{ shotSeq, fishType, betPerShot, crit, damage, hpRemaining, killed, captured, payout }`）
  - `fishingEnd({ sessionId }): Promise<{ sessionId, serverSeed, serverSeedHash, clientSeed, totalPayout }>`
  - `fishingVerifyShot({ sessionId, shotSeq, fishType, betPerShot }): Promise<FishingShotVerifyResponse 形狀>`

- [ ] **Step 1: 先寫失敗測試（確定性回放 + 竄改必失敗）**

Append to `frontend/src/services/provablyFairMock.test.js`:

```js
import { provablyFairMock } from './provablyFairMock'

describe('provablyFairMock 老虎機 round/settle/verify', () => {
  test('settle 揭露的 serverSeed 雜湊 == round 承諾雜湊', async () => {
    const round = await provablyFairMock.slotRound({ bet: 100, clientSeed: 'my-seed' })
    expect(round.serverSeedHash).toMatch(/^[0-9a-f]{64}$/)
    expect(round.serverSeed).toBeUndefined()
    const settle = await provablyFairMock.slotSettle({ roundId: round.roundId })
    expect(await sha256Hex(settle.serverSeed)).toBe(round.serverSeedHash)
  })

  test('verify 用揭露值 → commitmentValid && resultMatches && valid', async () => {
    const round = await provablyFairMock.slotRound({ bet: 100, clientSeed: 'my-seed' })
    await provablyFairMock.slotSettle({ roundId: round.roundId })
    const v = await provablyFairMock.verifyRound({ roundId: round.roundId })
    expect(v.commitmentValid).toBe(true)
    expect(v.resultMatches).toBe(true)
    expect(v.valid).toBe(true)
  })

  test('作弊演示：竄改 serverSeed → commitmentValid=false、valid=false', async () => {
    const round = await provablyFairMock.slotRound({ bet: 100, clientSeed: 'my-seed' })
    const settle = await provablyFairMock.slotSettle({ roundId: round.roundId })
    const tampered = settle.serverSeed.slice(0, -1) + (settle.serverSeed.endsWith('0') ? '1' : '0')
    const v = await provablyFairMock.verifyRound({ roundId: round.roundId, serverSeed: tampered })
    expect(v.usedProvidedSeed).toBe(true)
    expect(v.commitmentValid).toBe(false)
    expect(v.valid).toBe(false)
  })
})
```

> 前置：Vitest 的 jsdom 環境需有 `localStorage` 與 `crypto.subtle`。專案既有 `mockApi.test.js` 已在 jsdom 下用 `localStorage`；`crypto.subtle` 於 Node 18+/jsdom 由 `globalThis.crypto` 提供。若測試報 `crypto.subtle` undefined，在測試檔頂端加 `import { webcrypto } from 'node:crypto'; globalThis.crypto ??= webcrypto`（實作者遇到才加）。

- [ ] **Step 2: 執行測試確認失敗**

Run: `cd frontend && npx vitest run src/services/provablyFairMock.test.js`
Expected: FAIL（`provablyFairMock` 未 export）。

- [ ] **Step 3: 實作三遊戲推導與 verify（append 到 provablyFairMock.js）**

在 `provablyFairMock.js` 末尾加入。數值 import 契約檔（路徑與 `mockApi.js` 相同：`../../../contracts/*.json`）：

```js
import slotPaytableContract from '../../../contracts/slot-paytable.json'
import baccaratRulesContract from '../../../contracts/baccarat-rules.json'
import fishingSpeciesContract from '../../../contracts/fishing-species.json'
import fishingCombatContract from '../../../contracts/fishing-combat.json'

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
```

- [ ] **Step 4: 執行測試確認通過**

Run: `cd frontend && npx vitest run src/services/provablyFairMock.test.js`
Expected: PASS（含新的老虎機 round/settle/verify 與作弊演示測試）。

- [ ] **Step 5: Commit**

```bash
git add frontend/src/services/provablyFairMock.js frontend/src/services/provablyFairMock.test.js
git commit -m "feat(frontend): Provably Fair mock 三遊戲確定性推導與 verify（含作弊演示）"
```

---

### Task 3: `fairnessApi.js` 真/mock 切換層

唯一的真/mock 分歧點，形狀對齊後端。Panel 只呼叫這層。真實模式打 gateway；mock 模式呼叫 Task 2。

**Files:**
- Create: `frontend/src/services/fairnessApi.js`

**Interfaces:**
- Consumes：`./api`（axios 封裝，`api.get`/`api.post` 回 `res.data.data`）、`./provablyFairMock`。
- Produces（供 Task 5–7 panel 消費）：`fairnessApi.{ isMock, slotRound, slotSettle, baccaratBet, baccaratResult, verifyRound, fishingStart, fishingShots, fishingEnd, fishingVerifyShot }`，簽名與 Task 2 一致。

- [ ] **Step 1: 實作切換層**

Create `frontend/src/services/fairnessApi.js`:

```js
import api from './api'
import { provablyFairMock } from './provablyFairMock'

const useMock = import.meta.env.VITE_USE_MOCK_API !== 'false'

// 公平性展示頁專用 API：真實模式打 game-service（透過 gateway），mock 模式走本機密碼學模擬。
// 唯一的真/mock 分歧點——Panel 不知道自己在哪個模式（spec §5 職責邊界）。
export const fairnessApi = {
  isMock: useMock,

  // ---- 老虎機（commit-ahead 兩階段）----
  async slotRound({ bet, clientSeed }) {
    if (useMock) return provablyFairMock.slotRound({ bet, clientSeed })
    const res = await api.post('/api/v1/game/slot/round', { bet, clientSeed })
    return res.data.data
  },
  async slotSettle({ roundId }) {
    if (useMock) return provablyFairMock.slotSettle({ roundId })
    const res = await api.post(`/api/v1/game/slot/round/${roundId}/settle`)
    return res.data.data
  },

  // ---- 百家樂（bet 即扣款 → result 揭露）----
  async baccaratBet({ player, banker, tie, clientSeed }) {
    if (useMock) return provablyFairMock.baccaratBet({ player, banker, tie, clientSeed })
    const res = await api.post('/api/v1/game/baccarat/bet', { player, banker, tie, clientSeed })
    return res.data.data
  },
  async baccaratResult({ roundId }) {
    if (useMock) return provablyFairMock.baccaratResult({ roundId })
    const res = await api.post(`/api/v1/game/baccarat/${roundId}/result`)
    return res.data.data
  },

  // ---- 老虎機／百家樂共用驗證（serverSeed 選填；帶入竄改值即作弊演示）----
  async verifyRound({ roundId, serverSeed }) {
    if (useMock) return provablyFairMock.verifyRound({ roundId, serverSeed })
    const params = serverSeed ? { serverSeed } : {}
    const res = await api.get(`/api/v1/game/verify/${roundId}`, { params })
    return res.data.data
  },

  // ---- 捕魚機（場次級）----
  async fishingStart({ buyIn, cannonLevel, betPerShot, clientSeed }) {
    if (useMock) return provablyFairMock.fishingStart({ buyIn, cannonLevel, betPerShot, clientSeed })
    const res = await api.post('/api/v1/game/fishing/session/start', {
      buyIn,
      cannonLevel,
      betPerShot,
      clientSeed,
    })
    return res.data.data
  },
  async fishingShots({ sessionId, shots }) {
    if (useMock) return provablyFairMock.fishingShots({ sessionId, shots })
    const res = await api.post(`/api/v1/game/fishing/${sessionId}/shots`, { shots })
    return res.data.data
  },
  async fishingEnd({ sessionId }) {
    if (useMock) return provablyFairMock.fishingEnd({ sessionId })
    const res = await api.post(`/api/v1/game/fishing/${sessionId}/end`)
    return res.data.data
  },
  async fishingVerifyShot({ sessionId, shotSeq, fishType, betPerShot }) {
    if (useMock) return provablyFairMock.fishingVerifyShot({ sessionId, shotSeq, fishType, betPerShot })
    const res = await api.get(`/api/v1/game/fishing/${sessionId}/verify-shot`, {
      params: { shotSeq, fishType, betPerShot },
    })
    return res.data.data
  },
}
```

- [ ] **Step 2: 快速驗證（lint + import 正確）**

Run: `cd frontend && npx eslint src/services/fairnessApi.js`
Expected: 無錯誤。

- [ ] **Step 3: Commit**

```bash
git add frontend/src/services/fairnessApi.js
git commit -m "feat(frontend): Provably Fair 展示頁真/mock 切換層 fairnessApi"
```

---

### Task 4: 共用展示元件（StepRail / SeedCard / VerdictPanel / ResultDiff）+ 樣式

四個純展示元件，只吃 props、不呼叫 API、不持狀態。與 fairness.css 一起完成（同責任、一起變動）。

**Files:**
- Create: `frontend/src/components/fairness/StepRail.jsx`
- Create: `frontend/src/components/fairness/SeedCard.jsx`
- Create: `frontend/src/components/fairness/VerdictPanel.jsx`
- Create: `frontend/src/components/fairness/ResultDiff.jsx`
- Create: `frontend/src/components/fairness/fairness.css`

**Interfaces:**
- Produces：
  - `<StepRail steps={[{key,label}]} current={number} />` — `current` 為進行中步驟索引（0-based），< current 已完成、> current 未達。
  - `<SeedCard label={string} value={string|null} revealed={boolean} matchHex={string|null} />` — `value` 為 null 顯示鎖定態；`revealed && matchHex` 時逐字元比對高亮。
  - `<VerdictPanel commitmentValid={boolean} resultMatches={boolean} valid={boolean} message={string} />`
  - `<ResultDiff recomputed={object} stored={object} />` — 逐欄並排；值以 `JSON.stringify` 呈現。

- [ ] **Step 1: 寫樣式**

Create `frontend/src/components/fairness/fairness.css`:

```css
.fairness { max-width: 960px; margin: 0 auto; padding: 24px 16px 64px; color: #e8ecf5; }
.fairness__badge { display: inline-flex; align-items: center; gap: 6px; padding: 4px 12px; border-radius: 999px; font-size: 13px; font-weight: 600; }
.fairness__badge--real { background: #143d2b; color: #7bffb0; }
.fairness__badge--mock { background: #3d2f14; color: #ffd27b; }
.fairness__badge-note { margin-top: 8px; font-size: 12px; line-height: 1.6; color: #9aa4b8; }
.fairness__tabs { display: flex; gap: 8px; margin: 20px 0; }
.fairness__tab { padding: 8px 16px; border-radius: 8px; border: 1px solid #2a3550; background: transparent; color: #c8d0e0; cursor: pointer; }
.fairness__tab--active { background: #2a3550; color: #fff; }

.steprail { display: flex; gap: 4px; margin: 20px 0; }
.steprail__item { flex: 1; text-align: center; padding: 8px 4px; border-radius: 8px; font-size: 13px; background: #1a2237; color: #6b7690; }
.steprail__item--done { background: #143d2b; color: #7bffb0; }
.steprail__item--current { background: #1e3a5f; color: #7bc4ff; font-weight: 700; }

.seedcard { background: #141b2e; border: 1px solid #26314d; border-radius: 10px; padding: 12px 14px; margin: 8px 0; }
.seedcard__label { font-size: 12px; color: #9aa4b8; margin-bottom: 4px; }
.seedcard__value { font-family: monospace; font-size: 13px; word-break: break-all; }
.seedcard__locked { color: #ffb27b; font-style: italic; }
.seedcard__hex-match { color: #7bffb0; }
.seedcard__hex-diff { color: #ff7b7b; }
.seedcard__copy { margin-left: 8px; font-size: 12px; cursor: pointer; color: #7bc4ff; background: none; border: none; }

.verdict { display: flex; gap: 12px; margin: 12px 0; }
.verdict__lamp { flex: 1; text-align: center; padding: 12px; border-radius: 10px; font-weight: 600; }
.verdict__lamp--on { background: #143d2b; color: #7bffb0; }
.verdict__lamp--off { background: #3d1414; color: #ff7b7b; }
.verdict__message { margin-top: 8px; font-size: 13px; }

.resultdiff { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin: 12px 0; }
.resultdiff__col { background: #141b2e; border: 1px solid #26314d; border-radius: 10px; padding: 12px; }
.resultdiff__row { font-family: monospace; font-size: 12px; padding: 2px 0; word-break: break-all; }
.fairness__error { background: #3d1414; color: #ff9b9b; padding: 12px; border-radius: 10px; margin: 12px 0; font-size: 13px; }
```

- [ ] **Step 2: StepRail**

Create `frontend/src/components/fairness/StepRail.jsx`:

```jsx
// 五步驟進度：index < current 已完成、== current 進行中、> current 未達（純展示）。
export default function StepRail({ steps, current }) {
  return (
    <div className="steprail">
      {steps.map((step, i) => {
        const state = i < current ? 'done' : i === current ? 'current' : 'todo'
        return (
          <div key={step.key} className={`steprail__item steprail__item--${state}`}>
            {i + 1}. {step.label}
          </div>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 3: SeedCard**

Create `frontend/src/components/fairness/SeedCard.jsx`:

```jsx
// hash / seed 顯示。value 為 null → 鎖定態；revealed && matchHex → 逐字元比對高亮（④揭露用）。
export default function SeedCard({ label, value, revealed = false, matchHex = null }) {
  const copy = () => value && navigator.clipboard?.writeText(value)
  return (
    <div className="seedcard">
      <div className="seedcard__label">{label}</div>
      {value == null ? (
        <div className="seedcard__value seedcard__locked">尚未揭露</div>
      ) : (
        <div className="seedcard__value">
          {revealed && matchHex
            ? value.split('').map((ch, i) => (
                <span
                  key={i}
                  className={ch === matchHex[i] ? 'seedcard__hex-match' : 'seedcard__hex-diff'}
                >
                  {ch}
                </span>
              ))
            : value}
          <button type="button" className="seedcard__copy" onClick={copy}>
            複製
          </button>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: VerdictPanel**

Create `frontend/src/components/fairness/VerdictPanel.jsx`:

```jsx
// 三顆燈 + message（純展示）。commitmentValid / resultMatches / valid。
function Lamp({ label, on }) {
  return <div className={`verdict__lamp verdict__lamp--${on ? 'on' : 'off'}`}>{label}：{on ? '✓' : '✗'}</div>
}

export default function VerdictPanel({ commitmentValid, resultMatches, valid, message }) {
  return (
    <div>
      <div className="verdict">
        <Lamp label="承諾相符" on={commitmentValid} />
        <Lamp label="結果一致" on={resultMatches} />
        <Lamp label="整體通過" on={valid} />
      </div>
      {message && <div className="verdict__message">{message}</div>}
    </div>
  )
}
```

- [ ] **Step 5: ResultDiff**

Create `frontend/src/components/fairness/ResultDiff.jsx`:

```jsx
// recomputed vs stored 並排逐欄比對（純展示）。stored 可能為 null（真實模式後端已存值）。
function rows(obj) {
  if (!obj || typeof obj !== 'object') return []
  return Object.entries(obj).map(([k, v]) => [k, JSON.stringify(v)])
}

export default function ResultDiff({ recomputed, stored }) {
  return (
    <div className="resultdiff">
      <div className="resultdiff__col">
        <div className="seedcard__label">重算結果 recomputed</div>
        {rows(recomputed).map(([k, v]) => (
          <div key={k} className="resultdiff__row">
            {k}: {v}
          </div>
        ))}
      </div>
      <div className="resultdiff__col">
        <div className="seedcard__label">紀錄 stored</div>
        {rows(stored).map(([k, v]) => (
          <div key={k} className="resultdiff__row">
            {k}: {v}
          </div>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 6: 快速驗證**

Run: `cd frontend && npx eslint src/components/fairness/*.jsx`
Expected: 無錯誤。

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/fairness/StepRail.jsx frontend/src/components/fairness/SeedCard.jsx frontend/src/components/fairness/VerdictPanel.jsx frontend/src/components/fairness/ResultDiff.jsx frontend/src/components/fairness/fairness.css
git commit -m "feat(frontend): Provably Fair 展示頁共用展示元件與樣式"
```

---

### Task 5: SlotFairPanel（老虎機五步驟狀態機）+ 測試

老虎機面板：`round`（承諾）→ `settle`（下注＋開獎＋揭露）→ `verify`（驗證）+ 作弊按鈕。這是第一個 panel，含代表性測試，後兩個 panel 比照。

**Files:**
- Create: `frontend/src/components/fairness/panels/SlotFairPanel.jsx`
- Test: `frontend/src/components/fairness/panels/SlotFairPanel.test.jsx`

**Interfaces:**
- Consumes：`fairnessApi`（Task 3）、`StepRail`/`SeedCard`/`VerdictPanel`/`ResultDiff`（Task 4）、`sha256Hex`（Task 1，用於④即時展示 `SHA-256(serverSeed)`）、redux `setBalance`（真實模式更新餘額）、`useSelector` 讀 `state.wallet.balance`。
- Produces：`<SlotFairPanel />`（無 props；自持狀態機）。

- [ ] **Step 1: 先寫失敗測試（狀態機推進 + 餘額守門）**

Create `frontend/src/components/fairness/panels/SlotFairPanel.test.jsx`:

```jsx
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { Provider } from 'react-redux'
import { configureStore } from '@reduxjs/toolkit'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

// 攔截 fairnessApi，驗證 panel 依序呼叫 round → settle → verify。
vi.mock('../../../services/fairnessApi', () => ({
  fairnessApi: {
    isMock: true,
    slotRound: vi.fn(async () => ({
      roundId: 'R1',
      game: 'slot',
      bet: 100,
      serverSeedHash: 'a'.repeat(64),
      clientSeed: 'cs',
    })),
    slotSettle: vi.fn(async () => ({
      roundId: 'R1',
      grid: [['🍒', '🍋', '🔔'], ['🍒', '🍒', '🍒'], ['⭐', '7️⃣', '🍋']],
      bet: 100,
      multiplier: 5,
      payout: 500,
      winningCells: [[1, 0], [1, 1], [1, 2]],
      serverSeed: 'seed',
      serverSeedHash: 'a'.repeat(64),
      clientSeed: 'cs',
      nonce: 0,
    })),
    verifyRound: vi.fn(async () => ({
      roundId: 'R1',
      commitmentValid: true,
      resultMatches: true,
      valid: true,
      recomputed: { multiplier: 5 },
      stored: { multiplier: 5 },
      usedProvidedSeed: false,
      message: 'ok',
    })),
  },
}))

import SlotFairPanel from './SlotFairPanel'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

function makeStore(balance) {
  return configureStore({
    reducer: { wallet: (state = { balance }, action) => (action.type === 'wallet/setBalance' ? { balance: action.payload.balance } : state) },
  })
}

let container
let root
beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
})
afterEach(() => {
  if (root) act(() => root.unmount())
  root = null
  container.remove()
  vi.clearAllMocks()
})

function render(balance = 100000) {
  root = createRoot(container)
  act(() => {
    root.render(
      <Provider store={makeStore(balance)}>
        <SlotFairPanel />
      </Provider>,
    )
  })
}

async function clickText(text) {
  const btn = [...container.querySelectorAll('button')].find((b) => b.textContent.includes(text))
  await act(async () => {
    btn.click()
    await Promise.resolve()
  })
}

describe('SlotFairPanel', () => {
  test('承諾後顯示 serverSeedHash 與鎖定的 serverSeed', async () => {
    render()
    await clickText('鎖定本局')
    const { fairnessApi } = await import('../../../services/fairnessApi')
    expect(fairnessApi.slotRound).toHaveBeenCalledOnce()
    expect(container.textContent).toContain('a'.repeat(64))
    expect(container.textContent).toContain('尚未揭露')
  })

  test('餘額不足時擋下下注、顯示星幣不足、不呼叫 slotRound', async () => {
    render(10) // 低於預設 bet 100
    await clickText('鎖定本局')
    const { fairnessApi } = await import('../../../services/fairnessApi')
    expect(fairnessApi.slotRound).not.toHaveBeenCalled()
    expect(container.textContent).toContain('星幣不足')
  })
})
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `cd frontend && npx vitest run src/components/fairness/panels/SlotFairPanel.test.jsx`
Expected: FAIL（`SlotFairPanel` 不存在）。

- [ ] **Step 3: 實作 SlotFairPanel**

Create `frontend/src/components/fairness/panels/SlotFairPanel.jsx`:

```jsx
import { useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { fairnessApi } from '../../../services/fairnessApi'
import { sha256Hex } from '../../../services/provablyFairMock'
import { setBalance } from '../../../store/slices/walletSlice'
import StepRail from '../StepRail'
import SeedCard from '../SeedCard'
import VerdictPanel from '../VerdictPanel'
import ResultDiff from '../ResultDiff'

const STEPS = [
  { key: 'commit', label: '承諾' },
  { key: 'bet', label: '下注' },
  { key: 'reveal', label: '開獎/揭露' },
  { key: 'verify', label: '驗證' },
]

export default function SlotFairPanel() {
  const dispatch = useDispatch()
  const balance = useSelector((s) => s.wallet.balance)
  const [bet] = useState(100)
  const [clientSeed, setClientSeed] = useState('')
  const [round, setRound] = useState(null) // 承諾階段回應
  const [settle, setSettle] = useState(null) // 揭露階段回應
  const [revealHash, setRevealHash] = useState(null) // SHA-256(揭露的 serverSeed)
  const [verdict, setVerdict] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const current = verdict ? 4 : settle ? 3 : round ? 2 : 0

  async function doCommit() {
    setError('')
    if (balance < bet) {
      setError('星幣不足，無法下注')
      return
    }
    setBusy(true)
    try {
      setVerdict(null)
      setSettle(null)
      setRevealHash(null)
      setRound(await fairnessApi.slotRound({ bet, clientSeed: clientSeed || undefined }))
    } catch (e) {
      setError(`承諾失敗：${e.message}（POST /api/v1/game/slot/round）`)
    } finally {
      setBusy(false)
    }
  }

  async function doSettle() {
    setBusy(true)
    try {
      const s = await fairnessApi.slotSettle({ roundId: round.roundId })
      setSettle(s)
      setRevealHash(await sha256Hex(s.serverSeed)) // 即時展示 SHA-256(serverSeed) 與承諾比對
      if (!fairnessApi.isMock && s.wallet) dispatch(setBalance({ balance: s.wallet.balance }))
    } catch (e) {
      setError(`結算失敗：${e.message}（保留承諾可重試）`)
    } finally {
      setBusy(false)
    }
  }

  async function doVerify(tampered) {
    setBusy(true)
    try {
      const seed = tampered
        ? settle.serverSeed.slice(0, -1) + (settle.serverSeed.endsWith('0') ? '1' : '0')
        : undefined
      setVerdict(await fairnessApi.verifyRound({ roundId: round.roundId, serverSeed: seed }))
    } catch (e) {
      setError(`驗證失敗：${e.message}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <StepRail steps={STEPS} current={current} />
      {error && <div className="fairness__error">{error}</div>}

      {/* ①承諾 */}
      <SeedCard label="serverSeedHash（承諾）" value={round?.serverSeedHash ?? null} />
      <label className="seedcard__label">
        你的 clientSeed（可自訂，留空則伺服器產生）
        <input value={clientSeed} onChange={(e) => setClientSeed(e.target.value)} disabled={!!round} />
      </label>
      {!round && (
        <button type="button" onClick={doCommit} disabled={busy || balance < bet}>
          鎖定本局（下注 {bet}）
        </button>
      )}

      {/* ②③④ 下注→開獎→揭露 */}
      {round && !settle && (
        <button type="button" onClick={doSettle} disabled={busy}>
          下注並開獎（此時才扣款）
        </button>
      )}
      {settle && (
        <>
          <div className="resultdiff__row">倍率 {settle.multiplier}／派彩 {settle.payout}</div>
          <SeedCard
            label="serverSeed（揭露）／逐字元比對 SHA-256"
            value={settle.serverSeed}
            revealed
            matchHex={settle.serverSeed === null ? null : null}
          />
          <SeedCard label="SHA-256(serverSeed)（應等於承諾）" value={revealHash} revealed matchHex={round.serverSeedHash} />
        </>
      )}

      {/* ⑤驗證 + 作弊 */}
      {settle && (
        <div className="fairness__tabs">
          <button type="button" onClick={() => doVerify(false)} disabled={busy}>
            驗證這一局
          </button>
          <button type="button" onClick={() => doVerify(true)} disabled={busy}>
            模擬伺服器作弊
          </button>
        </div>
      )}
      {verdict && (
        <>
          <VerdictPanel
            commitmentValid={verdict.commitmentValid}
            resultMatches={verdict.resultMatches}
            valid={verdict.valid}
            message={verdict.message}
          />
          <ResultDiff recomputed={verdict.recomputed} stored={verdict.stored} />
        </>
      )}
    </div>
  )
}
```

> 註：④的第二張 `SeedCard` 把 `revealHash`（`SHA-256(serverSeed)`）與 `round.serverSeedHash`（承諾）逐字元比對高亮——相符則整條綠，這就是「這就是我一開始鎖定的那個值」的畫面。

- [ ] **Step 4: 執行測試確認通過**

Run: `cd frontend && npx vitest run src/components/fairness/panels/SlotFairPanel.test.jsx`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/fairness/panels/SlotFairPanel.jsx frontend/src/components/fairness/panels/SlotFairPanel.test.jsx
git commit -m "feat(frontend): Provably Fair 老虎機面板（五步驟狀態機 + 作弊演示 + 餘額守門）"
```

---

### Task 6: BaccaratFairPanel（百家樂五步驟狀態機）

比照 SlotFairPanel，差異：`baccaratBet` 一次完成①②（承諾＋下注，**bet 就扣款**，文案需標示），`baccaratResult` 完成③④。verify 共用 `fairnessApi.verifyRound`。

**Files:**
- Create: `frontend/src/components/fairness/panels/BaccaratFairPanel.jsx`

**Interfaces:**
- Consumes：同 Task 5（`fairnessApi.baccaratBet` / `baccaratResult` / `verifyRound`、`sha256Hex`、`setBalance`）。
- Produces：`<BaccaratFairPanel />`。

- [ ] **Step 1: 實作 BaccaratFairPanel**

Create `frontend/src/components/fairness/panels/BaccaratFairPanel.jsx`:

```jsx
import { useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { fairnessApi } from '../../../services/fairnessApi'
import { sha256Hex } from '../../../services/provablyFairMock'
import { setBalance } from '../../../store/slices/walletSlice'
import StepRail from '../StepRail'
import SeedCard from '../SeedCard'
import VerdictPanel from '../VerdictPanel'
import ResultDiff from '../ResultDiff'

const STEPS = [
  { key: 'commit', label: '承諾+下注' },
  { key: 'reveal', label: '開獎/揭露' },
  { key: 'verify', label: '驗證' },
]
const AMOUNT = 100

export default function BaccaratFairPanel() {
  const dispatch = useDispatch()
  const balance = useSelector((s) => s.wallet.balance)
  const [area, setArea] = useState('player') // 押注區：player/banker/tie
  const [clientSeed, setClientSeed] = useState('')
  const [betResp, setBetResp] = useState(null)
  const [result, setResult] = useState(null)
  const [revealHash, setRevealHash] = useState(null)
  const [verdict, setVerdict] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const current = verdict ? 3 : result ? 2 : betResp ? 1 : 0

  async function doBet() {
    setError('')
    if (balance < AMOUNT) {
      setError('星幣不足，無法下注')
      return
    }
    setBusy(true)
    try {
      setVerdict(null)
      setResult(null)
      setRevealHash(null)
      const body = { player: 0, banker: 0, tie: 0, [area]: AMOUNT, clientSeed: clientSeed || undefined }
      setBetResp(await fairnessApi.baccaratBet(body))
    } catch (e) {
      setError(`下注失敗：${e.message}（POST /api/v1/game/baccarat/bet）`)
    } finally {
      setBusy(false)
    }
  }

  async function doResult() {
    setBusy(true)
    try {
      const r = await fairnessApi.baccaratResult({ roundId: betResp.roundId })
      setResult(r)
      setRevealHash(await sha256Hex(r.serverSeed))
      if (!fairnessApi.isMock && r.wallet) dispatch(setBalance({ balance: r.wallet.balance }))
    } catch (e) {
      setError(`開獎失敗：${e.message}`)
    } finally {
      setBusy(false)
    }
  }

  async function doVerify(tampered) {
    setBusy(true)
    try {
      const seed = tampered
        ? result.serverSeed.slice(0, -1) + (result.serverSeed.endsWith('0') ? '1' : '0')
        : undefined
      setVerdict(await fairnessApi.verifyRound({ roundId: betResp.roundId, serverSeed: seed }))
    } catch (e) {
      setError(`驗證失敗：${e.message}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <StepRail steps={STEPS} current={current} />
      {error && <div className="fairness__error">{error}</div>}
      <div className="fairness__badge-note">注意：百家樂在下注（bet）時就扣款，與老虎機（結算才扣）不同。</div>

      <SeedCard label="serverSeedHash（承諾）" value={betResp?.serverSeedHash ?? null} />
      {!betResp && (
        <>
          <div className="fairness__tabs">
            {['player', 'banker', 'tie'].map((a) => (
              <button
                key={a}
                type="button"
                className={`fairness__tab ${area === a ? 'fairness__tab--active' : ''}`}
                onClick={() => setArea(a)}
              >
                {a === 'player' ? '閒' : a === 'banker' ? '莊' : '和'}
              </button>
            ))}
          </div>
          <label className="seedcard__label">
            你的 clientSeed（可自訂）
            <input value={clientSeed} onChange={(e) => setClientSeed(e.target.value)} />
          </label>
          <button type="button" onClick={doBet} disabled={busy || balance < AMOUNT}>
            下注 {AMOUNT} 到「{area === 'player' ? '閒' : area === 'banker' ? '莊' : '和'}」（此時扣款）
          </button>
        </>
      )}

      {betResp && !result && (
        <button type="button" onClick={doResult} disabled={busy}>
          開獎並揭露
        </button>
      )}
      {result && (
        <>
          <div className="resultdiff__row">
            閒 {result.playerScore}（{(result.playerCards || []).join(' ')}）｜莊 {result.bankerScore}（
            {(result.bankerCards || []).join(' ')}）｜結果 {result.result}
          </div>
          <SeedCard label="serverSeed（揭露）" value={result.serverSeed} />
          <SeedCard label="SHA-256(serverSeed)（應等於承諾）" value={revealHash} revealed matchHex={betResp.serverSeedHash} />
          <div className="fairness__tabs">
            <button type="button" onClick={() => doVerify(false)} disabled={busy}>
              驗證這一局
            </button>
            <button type="button" onClick={() => doVerify(true)} disabled={busy}>
              模擬伺服器作弊
            </button>
          </div>
        </>
      )}
      {verdict && (
        <>
          <VerdictPanel
            commitmentValid={verdict.commitmentValid}
            resultMatches={verdict.resultMatches}
            valid={verdict.valid}
            message={verdict.message}
          />
          <ResultDiff recomputed={verdict.recomputed} stored={verdict.stored} />
        </>
      )}
    </div>
  )
}
```

- [ ] **Step 2: 快速驗證**

Run: `cd frontend && npx eslint src/components/fairness/panels/BaccaratFairPanel.jsx`
Expected: 無錯誤。

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/fairness/panels/BaccaratFairPanel.jsx
git commit -m "feat(frontend): Provably Fair 百家樂面板（bet 即扣款，五步驟狀態機）"
```

---

### Task 7: FishingFairPanel（捕魚機五步驟狀態機）

捕魚以列表呈現每發結果（不做 Pixi）。流程：`fishingStart`（承諾）→ 連發 `fishingShots`（射擊）→ `fishingEnd`（揭露）→ `fishingVerifyShot`（逐發驗證）。作弊演示：對已結算場次以「不存在的 shotSeq」或（真實模式）錯 fishType 觸發 `commitmentValid=false` / 查無紀錄。

**Files:**
- Create: `frontend/src/components/fairness/panels/FishingFairPanel.jsx`

**Interfaces:**
- Consumes：`fairnessApi.fishingStart/fishingShots/fishingEnd/fishingVerifyShot`、`setBalance`、`fishing-species.json`（列出可選魚種）。
- Produces：`<FishingFairPanel />`。

- [ ] **Step 1: 實作 FishingFairPanel**

Create `frontend/src/components/fairness/panels/FishingFairPanel.jsx`:

```jsx
import { useState } from 'react'
import { useSelector } from 'react-redux'
import { fairnessApi } from '../../../services/fairnessApi'
import fishingSpecies from '../../../../contracts/fishing-species.json'
import StepRail from '../StepRail'
import SeedCard from '../SeedCard'
import VerdictPanel from '../VerdictPanel'

const STEPS = [
  { key: 'commit', label: '承諾/入場' },
  { key: 'shoot', label: '射擊' },
  { key: 'reveal', label: '揭露' },
  { key: 'verify', label: '逐發驗證' },
]
const BUY_IN = 1000
const BET_PER_SHOT = 10
const CANNON = 1
const SHOT_COUNT = 8
// 選一種普通魚做示範（避免 BOSS 打不死）。
const DEMO_FISH = fishingSpecies.species.find((f) => f.tier === 'SMALL')?.code || fishingSpecies.species[0].code

export default function FishingFairPanel() {
  const balance = useSelector((s) => s.wallet.balance)
  const [clientSeed, setClientSeed] = useState('')
  const [session, setSession] = useState(null)
  const [shots, setShots] = useState([])
  const [ended, setEnded] = useState(null)
  const [verifySeq, setVerifySeq] = useState(1)
  const [verdict, setVerdict] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const current = verdict ? 4 : ended ? 3 : shots.length ? 2 : session ? 1 : 0

  async function doStart() {
    setError('')
    if (balance < BUY_IN) {
      setError('星幣不足，無法入場')
      return
    }
    setBusy(true)
    try {
      setVerdict(null)
      setEnded(null)
      setShots([])
      setSession(
        await fairnessApi.fishingStart({
          buyIn: BUY_IN,
          cannonLevel: CANNON,
          betPerShot: BET_PER_SHOT,
          clientSeed: clientSeed || undefined,
        }),
      )
    } catch (e) {
      setError(`入場失敗：${e.message}（POST /api/v1/game/fishing/session/start）`)
    } finally {
      setBusy(false)
    }
  }

  async function doShoot() {
    setBusy(true)
    try {
      const batch = Array.from({ length: SHOT_COUNT }, (_, i) => ({
        shotSeq: shots.length + i + 1,
        fishType: DEMO_FISH,
        betPerShot: BET_PER_SHOT,
        cannonLevel: CANNON,
        fishInstanceId: 'demo-fish', // 同一條魚累傷
      }))
      const resp = await fairnessApi.fishingShots({ sessionId: session.sessionId, shots: batch })
      setShots((prev) => [...prev, ...resp.results])
    } catch (e) {
      setError(`射擊失敗：${e.message}`)
    } finally {
      setBusy(false)
    }
  }

  async function doEnd() {
    setBusy(true)
    try {
      setEnded(await fairnessApi.fishingEnd({ sessionId: session.sessionId }))
    } catch (e) {
      setError(`結算失敗：${e.message}`)
    } finally {
      setBusy(false)
    }
  }

  async function doVerify() {
    setBusy(true)
    try {
      setVerdict(
        await fairnessApi.fishingVerifyShot({
          sessionId: session.sessionId,
          shotSeq: verifySeq,
          fishType: DEMO_FISH,
          betPerShot: BET_PER_SHOT,
        }),
      )
    } catch (e) {
      setError(`驗證失敗：${e.message}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <StepRail steps={STEPS} current={current} />
      {error && <div className="fairness__error">{error}</div>}

      <SeedCard label="serverSeedHash（承諾）" value={session?.serverSeedHash ?? null} />
      {!session && (
        <>
          <label className="seedcard__label">
            你的 clientSeed（可自訂）
            <input value={clientSeed} onChange={(e) => setClientSeed(e.target.value)} />
          </label>
          <button type="button" onClick={doStart} disabled={busy || balance < BUY_IN}>
            入場（buy-in {BUY_IN}，每發 {BET_PER_SHOT}）
          </button>
        </>
      )}

      {session && !ended && (
        <button type="button" onClick={doShoot} disabled={busy}>
          開火 {SHOT_COUNT} 發（目標：{DEMO_FISH}）
        </button>
      )}

      {shots.length > 0 && (
        <div className="resultdiff__col">
          {shots.map((s) => (
            <div key={s.shotSeq} className="resultdiff__row">
              #{s.shotSeq} 傷害 {s.damage}
              {s.crit ? '（暴擊）' : ''} {s.killed ? (s.captured ? `→ 捕獲 派彩 ${s.payout}` : '→ 掙脫') : `剩 HP ${s.hpRemaining}`}
            </div>
          ))}
        </div>
      )}

      {session && shots.length > 0 && !ended && (
        <button type="button" onClick={doEnd} disabled={busy}>
          收網並揭露 serverSeed
        </button>
      )}
      {ended && (
        <>
          <SeedCard label="serverSeed（揭露）" value={ended.serverSeed} />
          <div className="fairness__tabs">
            <label className="seedcard__label">
              驗證第幾發
              <input
                type="number"
                min="1"
                value={verifySeq}
                onChange={(e) => setVerifySeq(Number(e.target.value))}
              />
            </label>
            <button type="button" onClick={doVerify} disabled={busy}>
              逐發驗證
            </button>
          </div>
        </>
      )}
      {verdict && (
        <VerdictPanel
          commitmentValid={verdict.commitmentValid}
          resultMatches={verdict.commitmentValid}
          valid={verdict.commitmentValid}
          message={verdict.message}
        />
      )}
    </div>
  )
}
```

> 註：捕魚 verify 回應無 `resultMatches`/`valid` 欄位（`FishingShotVerifyResponse` 只有 `commitmentValid`/`hit`/`payout`）；此處三顆燈以 `commitmentValid` 表達承諾是否相符，符合後端語意。

- [ ] **Step 2: 快速驗證**

Run: `cd frontend && npx eslint src/components/fairness/panels/FishingFairPanel.jsx`
Expected: 無錯誤。

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/fairness/panels/FishingFairPanel.jsx
git commit -m "feat(frontend): Provably Fair 捕魚機面板（逐發射擊列表 + 逐發驗證）"
```

---

### Task 8: ProvablyFair 頁面外殼（模式徽章 + 遊戲切換）

組裝頁面：模式徽章（含誠實性說明）、三遊戲 tab 切換、掛載對應 panel。

**Files:**
- Create: `frontend/src/pages/ProvablyFair.jsx`

**Interfaces:**
- Consumes：`fairnessApi.isMock`、三個 panel、`fairness.css`。
- Produces：`export default function ProvablyFair()`。

- [ ] **Step 1: 實作頁面**

Create `frontend/src/pages/ProvablyFair.jsx`:

```jsx
import { useState } from 'react'
import { fairnessApi } from '../services/fairnessApi'
import SlotFairPanel from '../components/fairness/panels/SlotFairPanel'
import BaccaratFairPanel from '../components/fairness/panels/BaccaratFairPanel'
import FishingFairPanel from '../components/fairness/panels/FishingFairPanel'
import '../components/fairness/fairness.css'

const GAMES = [
  { key: 'slot', label: '老虎機', Panel: SlotFairPanel },
  { key: 'baccarat', label: '百家樂', Panel: BaccaratFairPanel },
  { key: 'fishing', label: '捕魚機', Panel: FishingFairPanel },
]

export default function ProvablyFair() {
  const [game, setGame] = useState('slot')
  const isMock = fairnessApi.isMock
  const { Panel } = GAMES.find((g) => g.key === game)

  return (
    <div className="fairness">
      <h1>公平性驗證</h1>
      {/* 模式徽章（spec §4 硬性要求，不得移除）*/}
      {isMock ? (
        <div>
          <span className="fairness__badge fairness__badge--mock">本機模擬</span>
          <div className="fairness__badge-note">
            承諾雜湊為真實 SHA-256 計算，但結果比對為同一份前端邏輯重跑，不構成對後端的獨立驗證。
          </div>
        </div>
      ) : (
        <span className="fairness__badge fairness__badge--real">真實後端</span>
      )}

      <div className="fairness__tabs">
        {GAMES.map((g) => (
          <button
            key={g.key}
            type="button"
            className={`fairness__tab ${game === g.key ? 'fairness__tab--active' : ''}`}
            onClick={() => setGame(g.key)}
          >
            {g.label}
          </button>
        ))}
      </div>

      <Panel />
    </div>
  )
}
```

- [ ] **Step 2: 快速驗證**

Run: `cd frontend && npx eslint src/pages/ProvablyFair.jsx`
Expected: 無錯誤。

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/ProvablyFair.jsx
git commit -m "feat(frontend): Provably Fair 頁面外殼（模式徽章 + 遊戲切換）"
```

---

### Task 9: 路由註冊 + Lobby 入口 + CHANGELOG

把頁面接進 App 路由（lazy + PrivateRoute），Lobby 加入口卡片，記 CHANGELOG。

**Files:**
- Modify: `frontend/src/App.jsx`
- Modify: `frontend/src/pages/Lobby.jsx`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes：`ProvablyFair`（Task 8）、既有 `ProtectedPage`（`App.jsx:48`）。

- [ ] **Step 1: 註冊 lazy import（App.jsx）**

在 `frontend/src/App.jsx` 的 lazy 區塊（第 13–24 行附近）加入：

```jsx
const ProvablyFair = lazy(() => import('./pages/ProvablyFair'))
```

- [ ] **Step 2: 加路由（App.jsx）**

在 `frontend/src/App.jsx` 的 protected routes 區塊（`/records` 路由之後、`{enableDevTools ...}` 之前）加入：

```jsx
          <Route
            path="/provably-fair"
            element={
              <ProtectedPage>
                <ProvablyFair />
              </ProtectedPage>
            }
          />
```

- [ ] **Step 3: 手動驗證路由（dev server）**

Run: `cd frontend && npm run dev`（另開終端），瀏覽器登入後訪問 `http://localhost:5173/provably-fair`。
Expected：頁面顯示「本機模擬」徽章、三遊戲 tab；老虎機「鎖定本局」→ 顯示 64 字元 serverSeedHash、serverSeed「尚未揭露」；「下注並開獎」→ serverSeed 揭露且 `SHA-256(serverSeed)` 整條變綠；「驗證這一局」→ 三顆燈全亮；「模擬伺服器作弊」→「承諾相符」燈變紅。停掉 dev server。

- [ ] **Step 4: Lobby 入口卡片**

先看現有卡片結構：`Read frontend/src/pages/Lobby.jsx`，找到既有的遊戲/功能卡片 list（例如導向 `/game/slot` 的卡片），比照其 JSX 與 className 新增一張導向 `/provably-fair` 的卡片，文案「公平性驗證 — 看見每一局如何被鎖定與驗證」。

> 此步刻意不給死程式碼：Lobby 卡片樣式需 match 既有結構（CLAUDE.md §3 外科式修改）。用既有卡片當範本，只換 `to`/圖示/文案。

- [ ] **Step 5: 跑前端測試總綠**

Run: `cd frontend && npm run test`
Expected: PASS（含新增的 `provablyFairMock.test.js`、`SlotFairPanel.test.jsx`，且既有測試不受影響）。

- [ ] **Step 6: 記 CHANGELOG**

在 `CHANGELOG.md` 最上方新增：

```markdown
## [feat] — 2026-07-20 — Provably Fair 公平性驗證展示頁

### Added
- `frontend/src/pages/ProvablyFair.jsx`（路由 `/provably-fair`，lazy + PrivateRoute）：五步驟（承諾/下注/開獎/揭露/驗證）拆解呈現，涵蓋老虎機/百家樂/捕魚機，含「模擬伺服器作弊」演示。
- `frontend/src/services/provablyFairMock.js` + 測試：以 Web Crypto 移植後端 `RandomStream` 的 SHA-256 串流，mock 模式下驗證為真正的密碼學計算（承諾雜湊真、結果可確定性重放、竄改必失敗）。
- `frontend/src/services/fairnessApi.js`：真/mock 切換層，形狀對齊後端。
- `frontend/src/components/fairness/*`：StepRail/SeedCard/VerdictPanel/ResultDiff 展示元件與三遊戲 panel。
- `frontend/src/pages/Lobby.jsx`：新增展示頁入口卡片。

### Changed
- `frontend/src/App.jsx`：註冊 `/provably-fair` 受保護路由。

**為什麼**：後端 commit-reveal（T-030/T-036）已齊備但前端無頁面呈現，30 分鐘簡報「公平性可驗證」缺畫面；mock 模式原 `serverSeedHash` 與 seed 無數學關係，驗證是演出來的。本頁補上真實密碼學計算，斷網也能演。設計見 `docs/superpowers/plans/2026-07-20-provably-fair-demo-page.md`。
**如何驗證**：`cd frontend && npm run test`（新增 mock/panel 測試全綠）；dev server 手動走五步驟＋作弊演示（見計畫 Task 9 Step 3）。
```

- [ ] **Step 7: Commit**

```bash
git add frontend/src/App.jsx frontend/src/pages/Lobby.jsx CHANGELOG.md
git commit -m "feat(frontend): Provably Fair 展示頁接入路由與 Lobby 入口、記 CHANGELOG"
```

---

## 完成後的驗收清單

- [ ] `cd frontend && npm run test` 全綠。
- [ ] mock 模式：五步驟走得完、④揭露時 `SHA-256(serverSeed)` 與承諾逐字元對齊變綠、⑤三顆燈全亮、作弊按鈕讓「承諾相符」變紅。
- [ ] 三遊戲皆可操作；百家樂文案標示「bet 就扣款」、老虎機標示「settle 才扣」。
- [ ] `本機模擬` 徽章與誠實性說明存在且未被移除。
- [ ] 真實模式（`VITE_USE_MOCK_API=false` + 完整服務拓撲）下老虎機/百家樂/捕魚可打通並更新餘額（若無法起完整後端，至少確認 mock 模式；真實模式列為部署驗收）。

## Self-Review 註記（撰寫者已核）

- **Spec 覆蓋**：五步驟骨架（§6）→ StepRail + 各 panel；三遊戲（§3）→ Task 5–7；mock 真密碼學（§4 目標 3）→ Task 1–2；作弊演示（§6）→ verify tampered 分支；誠實徽章（§4 硬性）→ Task 8 + Global Constraints；錯誤處理（§7）→ 各 panel try/catch + 端點路徑提示 + 餘額守門；測試（§8）→ Task 1/2/5；進場點（§9）→ Task 9。§10 待定項（StepRail 視覺、捕魚預設參數、Lobby 文案）已在本計畫給定具體預設值。
- **型別一致**：`fairnessApi` 各方法簽名 = `provablyFairMock` = 後端 DTO 欄位（逐一對照 §後端契約表）。`createStream`/`sha256Hex`/`commit` 命名跨 Task 一致。
- **已知取捨**：捕魚 verify 三顆燈以 `commitmentValid` 表達（後端 `FishingShotVerifyResponse` 無 `resultMatches`/`valid`）；mock 的 `resultMatches` 因同函式重跑必為真，誠實性靠徽章明示（非隱藏）。
