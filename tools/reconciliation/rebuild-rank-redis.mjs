#!/usr/bin/env node
/**
 * rank Redis 可重建性（DR 重算腳本，藍圖 04 P4）。
 *
 * 設計原則：**Redis 裡的東西必須能從 DB 重建。** 目前不成立——
 *   - `rank:daily:winnings`（今日贏幣王，T-045）只存在 Redis，容器重啟（本專案未設 AOF/RDB）
 *     或 FLUSHDB 就永久消失，沒有任何重算路徑。
 *   - `rank:global:coins`（全服星幣）好一點（下一筆 wallet 事件的 ZADD 會修正該玩家），
 *     但只修正「有活動的玩家」——沒在玩的人會從排行榜消失。
 *
 * 本腳本從 PostgreSQL（wallet 寫庫）重算兩個 ZSET，**用 ZADD 絕對值（非 ZINCRBY）**——
 * 重算必須可重複執行、冪等。放 tools/ 而非服務內：跨 wallet 的 DB 與 rank 的 Redis 兩個服務邊界，
 * 放任一服務內都破壞邊界（與 ADR-009 對帳 script 同理）。
 *
 *   - 日贏分：wallet_transactions 中「今日（Asia/Taipei 日界）sub_type='WIN' 的 CREDIT」依 player_id 聚合。
 *   - 全服星幣：wallets 目前餘額。
 *
 * **--dry-run 兼作 P1（rank 消費去重）成效監測**：只印差異不寫入。若日贏分「重算值 < Redis 現值」，
 * 代表 Redis 被虛增了（P1 去重沒做好、at-least-once 重送被重複累加）。建議 P1 完成後接進日常對帳排程。
 *
 * 用法：
 *   cd tools/reconciliation && npm install
 *   node rebuild-rank-redis.mjs --dry-run   # 只比對、不寫入（安全，可當監測）
 *   node rebuild-rank-redis.mjs             # 實際 DEL + ZADD 重建
 * 環境變數（預設對齊 docker-compose 本機拓撲）：
 *   POSTGRES_HOST=localhost POSTGRES_PORT=5433 POSTGRES_DB=lucky_star_casino
 *   POSTGRES_USER=lucky_user POSTGRES_PASSWORD=lucky_password
 *   REDIS_HOST=localhost REDIS_PORT=6379
 *   DAILY_TZ=Asia/Taipei   日贏分的「當日」時區日界（對齊 DailyWinningsResetScheduler 的午夜重置）
 */

import pg from 'pg'
import { createClient } from 'redis'

// 必須與 RankService 常數一致（單一真相＝後端 RankService）
const DAILY_WINNINGS_KEY = 'rank:daily:winnings'
const GLOBAL_COINS_KEY = 'rank:global:coins'

const PG_HOST = process.env.POSTGRES_HOST || 'localhost'
const PG_PORT = Number(process.env.POSTGRES_PORT || 5433)
const PG_DB = process.env.POSTGRES_DB || 'lucky_star_casino'
const PG_USER = process.env.POSTGRES_USER || 'lucky_user'
const PG_PASSWORD = process.env.POSTGRES_PASSWORD || 'lucky_password'
const REDIS_HOST = process.env.REDIS_HOST || 'localhost'
const REDIS_PORT = Number(process.env.REDIS_PORT || 6379)
const DAILY_TZ = process.env.DAILY_TZ || 'Asia/Taipei'

const DRY_RUN = process.argv.includes('--dry-run')

// 今日 WIN CREDIT 聚合：以 Asia/Taipei 日界為準（對齊 DailyWinningsResetScheduler 的午夜重置）。
// created_at 為 TIMESTAMP；用 AT TIME ZONE 取得該時區今日 00:00 的對應瞬間再比較。
const DAILY_WINNINGS_SQL = `
  SELECT player_id, SUM(amount)::bigint AS total
  FROM wallet_transactions
  WHERE type = 'CREDIT'
    AND sub_type = 'WIN'
    AND created_at >= date_trunc('day', now() AT TIME ZONE $1) AT TIME ZONE $1
  GROUP BY player_id`

// 全服星幣：以 wallets 現餘額為準（>= 0 才納入，與 RankService.rebuildGlobalCoinsRank 一致）
const GLOBAL_COINS_SQL = `
  SELECT player_id, balance::bigint AS total
  FROM wallets
  WHERE balance >= 0`

/** 讀 DB 聚合成 Map<memberString, score>（score 為整數星幣）。 */
async function loadTargets(client) {
  const daily = new Map()
  const global = new Map()
  const dailyRes = await client.query(DAILY_WINNINGS_SQL, [DAILY_TZ])
  for (const r of dailyRes.rows) {
    if (r.total != null && Number(r.total) > 0) daily.set(String(r.player_id), Number(r.total))
  }
  const globalRes = await client.query(GLOBAL_COINS_SQL, [])
  for (const r of globalRes.rows) global.set(String(r.player_id), Number(r.total))
  return { daily, global }
}

/** 讀 Redis 現有 ZSET 成 Map<memberString, score>。 */
async function loadCurrent(redis, key) {
  const arr = await redis.zRangeWithScores(key, 0, -1)
  const map = new Map()
  for (const { value, score } of arr) map.set(value, Number(score))
  return map
}

/** 比對「目標（DB 重算）」與「現值（Redis）」，回傳差異統計。 */
function diff(target, current) {
  let missing = 0 // Redis 缺（DB 有、Redis 無）
  let extra = 0 // Redis 多（Redis 有、DB 無）
  let mismatch = 0 // 兩邊都有但分數不同
  let inflated = 0 // Redis 現值 > DB 重算值（P1 去重失效的訊號）
  for (const [m, score] of target) {
    if (!current.has(m)) missing++
    else if (current.get(m) !== score) {
      mismatch++
      if (current.get(m) > score) inflated++
    }
  }
  for (const m of current.keys()) {
    if (!target.has(m)) extra++
  }
  return { missing, extra, mismatch, inflated, targetSize: target.size, currentSize: current.size }
}

/** DEL + 批次 ZADD 重建（絕對值、冪等可重複執行）。 */
async function rebuild(redis, key, target) {
  await redis.del(key)
  if (target.size === 0) return 0
  const members = [...target].map(([value, score]) => ({ value, score }))
  await redis.zAdd(key, members)
  return members.length
}

async function main() {
  const client = new pg.Client({ host: PG_HOST, port: PG_PORT, database: PG_DB, user: PG_USER, password: PG_PASSWORD })
  const redis = createClient({ socket: { host: REDIS_HOST, port: REDIS_PORT } })
  redis.on('error', () => {}) // 錯誤在 connect() 時拋，避免未捕捉事件
  await client.connect()
  await redis.connect()

  try {
    const { daily, global } = await loadTargets(client)

    const jobs = [
      { key: DAILY_WINNINGS_KEY, target: daily, label: '日贏分（今日 WIN）' },
      { key: GLOBAL_COINS_KEY, target: global, label: '全服星幣' },
    ]

    console.log(DRY_RUN ? '模式：--dry-run（只比對、不寫入）\n' : '模式：實際重建（DEL + ZADD）\n')
    let inflatedTotal = 0

    for (const job of jobs) {
      const current = await loadCurrent(redis, job.key)
      const d = diff(job.target, current)
      inflatedTotal += d.inflated
      console.log(`[${job.label}] key=${job.key}`)
      console.log(
        `  DB 重算 ${d.targetSize} 筆 / Redis 現有 ${d.currentSize} 筆` +
          ` → 缺 ${d.missing}、多 ${d.extra}、分數不符 ${d.mismatch}（其中 Redis 偏高 ${d.inflated}）`,
      )
      if (!DRY_RUN) {
        const n = await rebuild(redis, job.key, job.target)
        console.log(`  已重建：DEL + ZADD ${n} 筆`)
      }
      console.log()
    }

    if (DRY_RUN && inflatedTotal > 0) {
      // Redis 偏高＝可能被 at-least-once 重送重複累加（P1 去重失效的訊號）
      console.error(
        `⚠️ 偵測到 ${inflatedTotal} 筆 Redis 分數高於 DB 重算值——` +
          `日贏分可能被虛增（檢查 P1 rank 消費去重是否生效）。`,
      )
      process.exit(1)
    }
    console.log(DRY_RUN ? '比對完成。' : '重建完成。')
  } finally {
    await client.end()
    await redis.quit()
  }
}

main().catch((err) => {
  console.error('rebuild-rank-redis 執行失敗（連線/查詢錯誤）:', err.message)
  process.exit(2)
})
