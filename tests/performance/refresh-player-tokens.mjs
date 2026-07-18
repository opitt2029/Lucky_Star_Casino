#!/usr/bin/env node
/**
 * T-090 壓測前臨發 token：把 players.csv 全部玩家重登入一輪，原地換成新鮮 JWT。
 *
 * 為什麼需要：JWT access token 效期 15 分鐘（JWT_ACCESS_TOKEN_EXPIRY_MS 預設 900000），
 * 但 1,000 名 provisioning 約 8 分鐘——provision 時發的 token 到壓測中後段會逐批到期
 * （2026-07-18 輪的 401×1,113 工件）。壓測起跑前先跑本腳本，token 年齡歸零，
 * 60 秒壓測輪有 13 分鐘以上裕度。
 *
 * 為什麼直打 member-service（8081）而非 gateway：
 *   1. gateway 對 /api/v1/auth/** 限流 5/s → 1,000 次重登入至少 200 秒，臨發就失去意義；
 *   2. 壓測前不該去污染 gateway 的限流桶／AIMD 窗狀態。
 * 路徑與回應格式和走 gateway 完全相同（gateway 對 auth 只做轉發）。
 *
 * 用法（provision 完成後、jmeter 起跑前）：
 *   node tests/performance/refresh-player-tokens.mjs
 * 環境變數：
 *   MEMBER_URL     預設 http://localhost:8081（member-service 直連）
 *   CSV            預設 tests/performance/players.csv（讀寫同一檔）
 *   PLAYER_PASS    預設 perf12345（provision-players.mjs 的統一密碼）
 *   CONCURRENCY    預設 25
 *
 * CSV 必須含第三欄 username（2026-07-18 起 provision-players.mjs 產出）；
 * 舊格式（僅 playerId,accessToken）無從重登入，請重跑 provisioning。
 * 任何一名玩家重登入失敗即 exit(1)：JMeter 要求 ≥ threads 列，缺列會讓整輪作廢。
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '../..')

const MEMBER = process.env.MEMBER_URL || 'http://localhost:8081'
const CSV = process.env.CSV || resolve(root, 'tests/performance/players.csv')
const PLAYER_PASS = process.env.PLAYER_PASS || 'perf12345'
const CONCURRENCY = Number(process.env.CONCURRENCY || 25)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const dataOf = (j) => (j && typeof j === 'object' && 'data' in j ? j.data : j)

async function httpOnce(method, path, body) {
  const res = await fetch(`${MEMBER}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  let json
  try { json = text ? JSON.parse(text) : null } catch { json = text }
  return { status: res.status, json, text }
}

// 直連 member 正常不會 429；保留退避是為了 MEMBER_URL 指回 gateway 時仍可用。
async function http(method, path, body) {
  let delay = 200
  for (let attempt = 0; attempt < 8; attempt++) {
    const r = await httpOnce(method, path, body)
    if (r.status !== 429) return r
    await sleep(delay + Math.floor(Math.random() * delay))
    delay = Math.min(delay * 2, 4000)
  }
  return httpOnce(method, path, body)
}

async function refreshOne(row) {
  const r = await http('POST', '/api/v1/auth/login', { username: row.username, password: PLAYER_PASS })
  const token = dataOf(r.json)?.accessToken
  if (r.status !== 200 || !token) {
    throw new Error(`login failed status=${r.status} body=${(r.text || '').slice(0, 120)}`)
  }
  row.accessToken = token
}

async function main() {
  const lines = readFileSync(CSV, 'utf8').split(/\r?\n/).filter((l) => l.trim())
  const header = lines.shift()
  const rows = lines.map((l) => {
    const [playerId, accessToken, username] = l.split(',')
    return { playerId, accessToken, username }
  })
  if (!header.includes('username') || rows.some((r) => !r.username)) {
    console.error(`CSV 缺 username 欄（${CSV}）：舊格式無從重登入，請重跑 provision-players.mjs`)
    process.exit(1)
  }

  console.log(`=== T-090 token refresh: ${rows.length} players（${MEMBER}） ===`)
  const t0 = Date.now()
  const failures = []
  let next = 0
  let done = 0

  async function worker() {
    while (true) {
      const i = next++
      if (i >= rows.length) return
      try {
        await refreshOne(rows[i])
        if (++done % 200 === 0) console.log(`  refreshed ${done}/${rows.length}`)
      } catch (e) {
        failures.push({ playerId: rows[i].playerId, error: e.message })
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker))

  const secs = ((Date.now() - t0) / 1000).toFixed(1)
  if (failures.length) {
    console.error(`\n✗ ${failures.length} 名重登入失敗（${secs}s），CSV 未改寫。前 10 筆：`)
    failures.slice(0, 10).forEach((f) => console.error(`  player ${f.playerId}: ${f.error}`))
    process.exit(1)
  }

  const csv = ['playerId,accessToken,username', ...rows.map((r) => `${r.playerId},${r.accessToken},${r.username}`)].join('\n') + '\n'
  writeFileSync(CSV, csv, 'utf8')
  console.log(`\n=== ${rows.length} 名 token 全數重發完成（${secs}s），CSV 已更新：${CSV} ===`)
  console.log(`token 最早簽發於 ${secs}s 前，15 分鐘效期下請於 ${(15 - Math.ceil(secs / 60) - 1)} 分鐘內起跑壓測。`)
}

main().catch((e) => {
  console.error('token refresh 發生未預期錯誤：', e)
  process.exit(2)
})
