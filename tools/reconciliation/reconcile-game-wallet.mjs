#!/usr/bin/env node
/**
 * game↔wallet 對帳（ADR-009 Saga 補償的護欄）。
 *
 * game-service 與 wallet-service 的寫庫同在 PostgreSQL `lucky_star_casino`
 * （ADR-001：game_rounds / pending_wallet_credits / wallets / wallet_transactions），
 * 但兩者分屬不同服務邊界——對帳跨邊界比對，故做成獨立 script 放 tools/（不進任一服務）。
 *
 * 檢查項目（輸出格式比照 tests/performance/accounting-reconciliation.sql：
 * check_name, violation_count, description；任一 violation > 0 時退出碼 1）：
 *   1. slot/baccarat 已結算且應派彩的對局，wallet 缺對應 credit 流水，且無補償單兜底
 *   2. fishing 已結算且 credited > 0 的場次，wallet 缺對應 credit 流水，且無補償單兜底
 *   3. 派彩/返還金額與 wallet 流水金額不一致（同一冪等鍵）
 *   4. 補償單 FAILED（重試超限，需人工處理）
 *   5. 補償單 PENDING 滯留超過 STALE_MINUTES（排程可能沒在跑）
 *   6. 補償單標 DONE 但 wallet 查無該冪等鍵流水（不應發生）
 *   7. 遊戲下注 debit 存在但對局未落地（結算中斷的線索，資訊型）
 *
 * 冪等鍵契約（單一真相＝各遊戲服務）：
 *   SLOT 派彩       slot-win-<roundId>
 *   BACCARAT 派彩   bac-win-<roundId>（金額含反水）
 *   FISHING 返還    fishing-end-<sessionId>（金額 = result_data.credited）
 *
 * 用法：
 *   cd tools/reconciliation && npm install && node reconcile-game-wallet.mjs
 * 環境變數（預設對齊 docker-compose 本機拓撲）：
 *   POSTGRES_HOST=localhost POSTGRES_PORT=5433 POSTGRES_DB=lucky_star_casino
 *   POSTGRES_USER=lucky_user POSTGRES_PASSWORD=lucky_password
 *   GRACE_MINUTES=2   結算後多久內的缺漏不計違規（補償排程 30 秒內會補）
 *   STALE_MINUTES=10  PENDING 滯留多久視為異常
 */

import pg from 'pg'

const HOST = process.env.POSTGRES_HOST || 'localhost'
const PORT = Number(process.env.POSTGRES_PORT || 5433)
const DB = process.env.POSTGRES_DB || 'lucky_star_casino'
const USER = process.env.POSTGRES_USER || 'lucky_user'
const PASSWORD = process.env.POSTGRES_PASSWORD || 'lucky_password'
const GRACE_MINUTES = Number(process.env.GRACE_MINUTES || 2)
const STALE_MINUTES = Number(process.env.STALE_MINUTES || 10)

// 每檢查一個 CTE 風格 SQL：回傳 violation_count 與少量樣本（rows）供定位
const CHECKS = [
  {
    name: 'settled_round_missing_credit',
    description:
      'slot/baccarat 已結算且 win_amount>0 的對局，wallet 必須有同冪等鍵的 credit 流水（或至少有補償單 PENDING/DONE 兜底）',
    sql: `
      SELECT gr.round_id, gr.game_type, gr.player_id, gr.win_amount
      FROM game_rounds gr
      LEFT JOIN wallet_transactions wt
        ON wt.idempotency_key = CASE gr.game_type
             WHEN 'SLOT' THEN 'slot-win-' || gr.round_id
             WHEN 'BACCARAT' THEN 'bac-win-' || gr.round_id
           END
      LEFT JOIN pending_wallet_credits pwc
        ON pwc.round_id = gr.round_id AND pwc.status IN ('PENDING', 'DONE')
      WHERE gr.game_type IN ('SLOT', 'BACCARAT')
        AND gr.status = 'SETTLED'
        AND gr.win_amount > 0
        AND gr.settled_at < NOW() - ($1 || ' minutes')::interval
        AND wt.id IS NULL
        AND pwc.id IS NULL`,
    params: () => [GRACE_MINUTES],
  },
  {
    name: 'fishing_session_missing_credit',
    description:
      'fishing 已結算且 credited>0 的場次，wallet 必須有 fishing-end-<sessionId> 的 credit 流水（或補償單兜底）',
    sql: `
      SELECT gr.round_id, gr.player_id,
             (gr.result_data::jsonb ->> 'credited')::bigint AS credited
      FROM game_rounds gr
      LEFT JOIN wallet_transactions wt
        ON wt.idempotency_key = 'fishing-end-' || gr.round_id
      LEFT JOIN pending_wallet_credits pwc
        ON pwc.round_id = gr.round_id AND pwc.status IN ('PENDING', 'DONE')
      WHERE gr.game_type = 'FISHING'
        AND gr.status = 'SETTLED'
        AND COALESCE((gr.result_data::jsonb ->> 'credited')::bigint, 0) > 0
        AND gr.settled_at < NOW() - ($1 || ' minutes')::interval
        AND wt.id IS NULL
        AND pwc.id IS NULL`,
    params: () => [GRACE_MINUTES],
  },
  {
    name: 'credit_amount_mismatch',
    description: '同一冪等鍵下，遊戲側應付金額與 wallet 流水金額必須一致',
    sql: `
      SELECT gr.round_id, gr.game_type, gr.win_amount AS expected, wt.amount AS actual
      FROM game_rounds gr
      JOIN wallet_transactions wt
        ON wt.idempotency_key = CASE gr.game_type
             WHEN 'SLOT' THEN 'slot-win-' || gr.round_id
             WHEN 'BACCARAT' THEN 'bac-win-' || gr.round_id
           END
      WHERE gr.game_type IN ('SLOT', 'BACCARAT')
        AND gr.status = 'SETTLED'
        AND gr.win_amount > 0
        AND wt.amount <> gr.win_amount
      UNION ALL
      SELECT gr.round_id, gr.game_type,
             (gr.result_data::jsonb ->> 'credited')::bigint AS expected, wt.amount AS actual
      FROM game_rounds gr
      JOIN wallet_transactions wt ON wt.idempotency_key = 'fishing-end-' || gr.round_id
      WHERE gr.game_type = 'FISHING'
        AND gr.status = 'SETTLED'
        AND wt.amount <> COALESCE((gr.result_data::jsonb ->> 'credited')::bigint, 0)`,
    params: () => [],
  },
  {
    name: 'failed_compensations',
    description: '補償單 FAILED（重試超限）：欠玩家的錢送不進 wallet，需人工處理',
    sql: `
      SELECT id, game_type, round_id, player_id, amount, sub_type, retry_count, last_error
      FROM pending_wallet_credits
      WHERE status = 'FAILED'`,
    params: () => [],
  },
  {
    name: 'stale_pending_compensations',
    description: `補償單 PENDING 滯留超過 ${STALE_MINUTES} 分鐘：確認 game-service 補償排程有在跑`,
    sql: `
      SELECT id, game_type, round_id, player_id, amount, retry_count, created_at
      FROM pending_wallet_credits
      WHERE status = 'PENDING'
        AND created_at < NOW() - ($1 || ' minutes')::interval`,
    params: () => [STALE_MINUTES],
  },
  {
    name: 'done_compensation_without_wallet_tx',
    description: '補償單標 DONE 但 wallet 查無該冪等鍵流水（不應發生，表示狀態被錯標）',
    sql: `
      SELECT pwc.id, pwc.round_id, pwc.player_id, pwc.amount, pwc.idempotency_key
      FROM pending_wallet_credits pwc
      LEFT JOIN wallet_transactions wt ON wt.idempotency_key = pwc.idempotency_key
      WHERE pwc.status = 'DONE'
        AND wt.id IS NULL`,
    params: () => [],
  },
  {
    name: 'bet_debit_without_round',
    description:
      '下注 debit 存在但對局未落地（資訊型，不計退出碼：可能是在途對局（百家樂 Session TTL 30 分鐘）'
      + '或結算在派彩前中斷；超過 30 分鐘仍在列者要人工確認）',
    informational: true,
    sql: `
      SELECT wt.idempotency_key, wt.player_id, wt.amount, wt.created_at
      FROM wallet_transactions wt
      WHERE wt.type = 'DEBIT'
        AND (wt.idempotency_key LIKE 'slot-bet-%' OR wt.idempotency_key LIKE 'bac-bet-%')
        AND wt.created_at < NOW() - ($1 || ' minutes')::interval
        AND NOT EXISTS (
          SELECT 1 FROM game_rounds gr WHERE gr.round_id = wt.reference_id
        )`,
    params: () => [GRACE_MINUTES],
  },
]

async function main() {
  const client = new pg.Client({ host: HOST, port: PORT, database: DB, user: USER, password: PASSWORD })
  await client.connect()

  let totalViolations = 0
  const summary = []
  try {
    for (const check of CHECKS) {
      const { rows } = await client.query(check.sql, check.params())
      summary.push({ check_name: check.name, violation_count: rows.length, description: check.description })
      if (!check.informational) totalViolations += rows.length
      if (rows.length > 0) {
        console.error(`\n[${check.name}] ${rows.length} 筆${check.informational ? '（資訊型）' : '異常'}（最多列 5 筆樣本）:`)
        for (const row of rows.slice(0, 5)) console.error('  ', JSON.stringify(row))
      }
    }
  } finally {
    await client.end()
  }

  console.log('\ncheck_name,violation_count,description')
  for (const s of summary) console.log(`${s.check_name},${s.violation_count},"${s.description}"`)

  if (totalViolations > 0) {
    console.error(`\n對帳失敗：共 ${totalViolations} 筆異常`)
    process.exit(1)
  }
  console.log('\n對帳通過：game↔wallet 無缺漏')
}

main().catch((err) => {
  console.error('對帳執行失敗（連線/查詢錯誤）:', err.message)
  process.exit(2)
})
