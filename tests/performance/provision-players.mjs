#!/usr/bin/env node
/**
 * T-090 壓測前置：批量建立並入金 N 名玩家，輸出 tests/performance/players.csv。
 *
 * 流程（每名玩家）：
 *   1. 經 gateway 註冊 /api/v1/auth/register → 取 playerId
 *   2. 登入 /api/v1/auth/login → 取玩家 JWT（accessToken）
 *   3. 等錢包由 member.registered 事件非同步建立（輪詢 /api/v1/wallet/balance 直到 200）
 *   4. 入金：優先用 T-055 GM 發幣（admin-service:8086，需 SUPER_ADMIN）大額發放，
 *      使每名玩家餘額足夠 60 秒持續下注；admin 不可達時退回 /api/v1/wallet/bankruptcy-aid（同步 1000）。
 *   5. 輪詢餘額達門檻後，寫一列 playerId,accessToken 進 CSV。
 *
 * 冪等鍵一律由伺服器端生成（AGENTS.md §12）；本腳本不傳任何 client 端冪等鍵。
 *
 * 用法：
 *   node tests/performance/provision-players.mjs                 # 預設 1000 名
 *   PLAYERS=50 node tests/performance/provision-players.mjs       # 自訂人數
 * 環境變數：
 *   GATEWAY_URL    預設 http://localhost:8080
 *   ADMIN_URL      預設 http://localhost:8086（GM 發幣，繞過 gateway 用 admin JWT）
 *   ADMIN_USER     預設 superadmin
 *   ADMIN_PASS     預設 ChangeMe!SuperAdmin123（對應 AdminUserSeeder 預設）
 *   PLAYERS        預設 1000
 *   GRANT_AMOUNT   預設 1000000（每名玩家 GM 發幣金額）
 *   MIN_BALANCE    預設 500000（CSV 寫入前要求達到的最低餘額）
 *   CONCURRENCY    預設 25（同時處理的玩家數）
 *   OUT           預設 tests/performance/players.csv
 */

import { writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '../..')

const GATEWAY = process.env.GATEWAY_URL || 'http://localhost:8080'
const ADMIN = process.env.ADMIN_URL || 'http://localhost:8086'
const ADMIN_USER = process.env.ADMIN_USER || 'superadmin'
const ADMIN_PASS = process.env.ADMIN_PASS || 'ChangeMe!SuperAdmin123'
const PLAYERS = Number(process.env.PLAYERS || 1000)
const GRANT_AMOUNT = Number(process.env.GRANT_AMOUNT || 1_000_000)
const MIN_BALANCE = Number(process.env.MIN_BALANCE || 500_000)
const CONCURRENCY = Number(process.env.CONCURRENCY || 25)
const OUT = process.env.OUT || resolve(root, 'tests/performance/players.csv')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const dataOf = (j) => (j && typeof j === 'object' && 'data' in j ? j.data : j)

async function httpOnce(base, method, path, { token, body } = {}) {
  const opts = { method, headers: {} }
  if (token) opts.headers['Authorization'] = `Bearer ${token}`
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json'
    opts.body = JSON.stringify(body)
  }
  const res = await fetch(`${base}${path}`, opts)
  const text = await res.text()
  let json
  try { json = text ? JSON.parse(text) : null } catch { json = text }
  return { status: res.status, json, text }
}

// 對 429（gateway 對 /api/v1/auth/** 的限流）做指數退避重試，避免大量並發註冊/登入被擋。
async function http(base, method, path, opts = {}) {
  let delay = 200
  for (let attempt = 0; attempt < 8; attempt++) {
    const r = await httpOnce(base, method, path, opts)
    if (r.status !== 429) return r
    await sleep(delay + Math.floor(Math.random() * delay))
    delay = Math.min(delay * 2, 4000)
  }
  return httpOnce(base, method, path, opts)
}

// ── admin GM 發幣：取得 SUPER_ADMIN JWT（一次） ──────────────────────────────
let adminToken = null
let adminAvailable = false
async function loginAdmin() {
  try {
    const r = await http(ADMIN, 'POST', '/admin/auth/login', {
      body: { username: ADMIN_USER, password: ADMIN_PASS },
    })
    adminToken = dataOf(r.json)?.accessToken || r.json?.accessToken
    adminAvailable = r.status === 200 && !!adminToken
    if (adminAvailable) {
      console.log(`[admin] GM 發幣可用（${ADMIN}，user=${ADMIN_USER}），每名發 ${GRANT_AMOUNT}`)
    } else {
      console.warn(`[admin] 登入失敗 status=${r.status}，退回 bankruptcy-aid（1000/人）`)
    }
  } catch (e) {
    console.warn(`[admin] 不可達（${e.message}），退回 bankruptcy-aid（1000/人）`)
  }
}

async function fund(playerId, token) {
  if (adminAvailable) {
    // T-055 GM 發幣：非同步（wallet.credit.request），稍後由 pollBalance 等待入帳。
    await http(ADMIN, 'POST', '/admin/gm/grant', {
      token: adminToken,
      body: { playerId: Number(playerId), amount: GRANT_AMOUNT, reason: 'T-090 load test funding' },
    })
  } else {
    // 同步注資 1000（僅在餘額 < 100 時生效）。
    await http(GATEWAY, 'POST', '/api/v1/wallet/bankruptcy-aid', { token })
  }
}

async function pollBalance(token, { min, tries = 30, intervalMs = 1000 }) {
  for (let i = 0; i < tries; i++) {
    const r = await http(GATEWAY, 'GET', '/api/v1/wallet/balance', { token })
    if (r.status === 200) {
      const d = dataOf(r.json)
      const bal = Number(d?.balance ?? d?.totalBalance ?? 0)
      if (bal >= min) return bal
    }
    await sleep(intervalMs)
  }
  return -1
}

async function provisionOne(index) {
  const stamp = `${Date.now()}_${index}`
  const username = `t090_${stamp}`
  const cred = { username, email: `${username}@perf.test`, password: 'perf12345', nickname: `T090-${index}` }

  const reg = await http(GATEWAY, 'POST', '/api/v1/auth/register', { body: cred })
  const playerId = dataOf(reg.json)?.id
  if (reg.status !== 201 || !playerId) {
    throw new Error(`register failed status=${reg.status} body=${reg.text.slice(0, 120)}`)
  }

  const login = await http(GATEWAY, 'POST', '/api/v1/auth/login', {
    body: { username: cred.username, password: cred.password },
  })
  const token = dataOf(login.json)?.accessToken
  if (login.status !== 200 || !token) {
    throw new Error(`login failed status=${login.status}`)
  }

  // 等錢包建立（Kafka member.registered → createWallet）
  const ready = await pollBalance(token, { min: 0, tries: 20 })
  if (ready < 0) throw new Error('wallet not created within 20s')

  await fund(playerId, token)
  const bal = await pollBalance(token, { min: adminAvailable ? MIN_BALANCE : 100 })
  if (bal < 0) throw new Error(`funding did not reach threshold (min=${adminAvailable ? MIN_BALANCE : 100})`)

  return { playerId: String(playerId), accessToken: token, balance: bal }
}

async function main() {
  console.log(`=== T-090 provisioning: ${PLAYERS} players ===`)
  console.log(`gateway: ${GATEWAY}`)
  await loginAdmin()

  const rows = []
  const failures = []
  let next = 0

  async function worker() {
    while (true) {
      const i = next++
      if (i >= PLAYERS) return
      try {
        const row = await provisionOne(i)
        rows.push(row)
        if (rows.length % 50 === 0) console.log(`  provisioned ${rows.length}/${PLAYERS}`)
      } catch (e) {
        failures.push({ i, error: e.message })
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker))

  // 依 playerId 數值排序，輸出穩定的 CSV
  rows.sort((a, b) => Number(a.playerId) - Number(b.playerId))
  const csv = ['playerId,accessToken', ...rows.map((r) => `${r.playerId},${r.accessToken}`)].join('\n') + '\n'
  writeFileSync(OUT, csv, 'utf8')

  console.log(`\n=== 結果：${rows.length} 成功 / ${failures.length} 失敗（目標 ${PLAYERS}）===`)
  console.log(`CSV 寫入：${OUT}`)
  if (failures.length) {
    console.log('前 10 筆失敗：')
    failures.slice(0, 10).forEach((f) => console.log(`  #${f.i}: ${f.error}`))
  }
  if (rows.length < PLAYERS) {
    console.error(`\n⚠ 僅備齊 ${rows.length} 名（< ${PLAYERS}）；壓測 runner 會要求 ≥ threads 列資料。`)
    process.exit(1)
  }
}

main().catch((e) => {
  console.error('provisioning 發生未預期錯誤：', e)
  process.exit(2)
})
