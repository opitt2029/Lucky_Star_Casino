/**
 * database.test.js
 *
 * 測試資料庫初始化 SQL 檔案是否正確：
 *
 * MySQL（CQRS 讀端）：
 *   members、friendships、daily_checkins、
 *   task_definitions、player_tasks、gift_logs、wallet_transactions（讀庫副本）
 *
 * PostgreSQL（CQRS 寫端）：
 *   wallets、wallet_transactions、game_rounds、
 *   rank_history、rank_daily_snapshots、game_rtp_stats、admin_alerts
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');

// 讀取兩個 SQL 檔案（轉成小寫，方便不分大小寫比對）
const mysqlSql = readFileSync(resolve(ROOT, 'database/mysql/init.sql'), 'utf-8').toLowerCase();
const postgresSql = readFileSync(resolve(ROOT, 'database/postgres/init.sql'), 'utf-8').toLowerCase();

// ─────────────────────────────────────────────────────────────────────────────
// 輔助函式：確認某張表存在
// ─────────────────────────────────────────────────────────────────────────────
function hasTable(sql, tableName) {
  return sql.includes(`create table if not exists ${tableName}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// MySQL — 資料庫與字元集
// ─────────────────────────────────────────────────────────────────────────────
describe('MySQL init.sql — 資料庫設定', () => {

  test('應建立 lucky_star_casino 資料庫', () => {
    assert.ok(
      mysqlSql.includes('create database if not exists lucky_star_casino'),
      '找不到 CREATE DATABASE lucky_star_casino'
    );
  });

  test('應設定 utf8mb4 字元集（支援中文與 emoji）', () => {
    assert.ok(
      mysqlSql.includes('utf8mb4'),
      '資料庫應使用 utf8mb4 字元集，才能正確儲存中文與 emoji'
    );
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// MySQL — members 會員帳號主表
// ─────────────────────────────────────────────────────────────────────────────
describe('MySQL init.sql — members 資料表', () => {

  test('應建立 members 資料表', () => {
    assert.ok(hasTable(mysqlSql, 'members'), '找不到 members 資料表');
  });

  const requiredColumns = ['username', 'email', 'password_hash', 'is_active', 'created_at', 'updated_at'];
  for (const col of requiredColumns) {
    test(`members 應包含 ${col} 欄位`, () => {
      assert.ok(mysqlSql.includes(col), `members 缺少 ${col} 欄位`);
    });
  }

  test('username 與 email 應設定 UNIQUE 約束', () => {
    assert.ok(
      mysqlSql.includes('uq_members_username') && mysqlSql.includes('uq_members_email'),
      'username 和 email 應各有 UNIQUE 約束，防止重複帳號'
    );
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// MySQL — friendships 好友關係表
// ─────────────────────────────────────────────────────────────────────────────
describe('MySQL init.sql — friendships 資料表', () => {

  test('應建立 friendships 資料表', () => {
    assert.ok(hasTable(mysqlSql, 'friendships'), '找不到 friendships 資料表');
  });

  test('friendships 應包含 requester_id 與 receiver_id 欄位', () => {
    assert.ok(mysqlSql.includes('requester_id'), 'friendships 缺少 requester_id');
    assert.ok(mysqlSql.includes('receiver_id'), 'friendships 缺少 receiver_id');
  });

  test('friendships 應有 UNIQUE(requester_id, receiver_id) 防止重複申請', () => {
    assert.ok(
      mysqlSql.includes('uq_friendships_pair'),
      '缺少 UNIQUE 約束，可能會有重複的好友申請'
    );
  });

  test('friendships 應有 CHECK 約束防止自己加自己', () => {
    assert.ok(
      mysqlSql.includes('chk_friendships_no_self'),
      '缺少 CHECK 約束，玩家可以自己加自己為好友'
    );
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// MySQL — daily_checkins 每日簽到表
// ─────────────────────────────────────────────────────────────────────────────
describe('MySQL init.sql — daily_checkins 資料表', () => {

  test('應建立 daily_checkins 資料表', () => {
    assert.ok(hasTable(mysqlSql, 'daily_checkins'), '找不到 daily_checkins 資料表');
  });

  test('應包含 consecutive_days 欄位（連續簽到天數）', () => {
    assert.ok(
      mysqlSql.includes('consecutive_days'),
      'daily_checkins 缺少 consecutive_days 欄位'
    );
  });

  test('應有 UNIQUE(player_id, checkin_date) 防止同日重複簽到', () => {
    assert.ok(
      mysqlSql.includes('uq_daily_checkins_player_date'),
      '缺少 UNIQUE 約束，玩家可能重複簽到'
    );
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// MySQL — task_definitions 任務定義表
// ─────────────────────────────────────────────────────────────────────────────
describe('MySQL init.sql — task_definitions 資料表', () => {

  test('應建立 task_definitions 資料表', () => {
    assert.ok(hasTable(mysqlSql, 'task_definitions'), '找不到 task_definitions 資料表');
  });

  test('應包含 task_code、reward_amount、target_count 欄位', () => {
    assert.ok(mysqlSql.includes('task_code'), 'task_definitions 缺少 task_code');
    assert.ok(mysqlSql.includes('reward_amount'), 'task_definitions 缺少 reward_amount');
    assert.ok(mysqlSql.includes('target_count'), 'task_definitions 缺少 target_count');
  });

  test('reward_amount 應有 CHECK 約束確保大於 0', () => {
    assert.ok(
      mysqlSql.includes('chk_task_reward_amount'),
      'reward_amount 應有 CHECK 約束，避免設定負數獎勵'
    );
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// MySQL — player_tasks 玩家任務進度表
// ─────────────────────────────────────────────────────────────────────────────
describe('MySQL init.sql — player_tasks 資料表', () => {

  test('應建立 player_tasks 資料表', () => {
    assert.ok(hasTable(mysqlSql, 'player_tasks'), '找不到 player_tasks 資料表');
  });

  test('應包含 progress 與 is_completed 欄位', () => {
    assert.ok(mysqlSql.includes('progress'), 'player_tasks 缺少 progress 欄位');
    assert.ok(mysqlSql.includes('is_completed'), 'player_tasks 缺少 is_completed 欄位');
  });

  test('應有 UNIQUE(player_id, task_id) 確保每人每任務只有一筆進度', () => {
    assert.ok(
      mysqlSql.includes('uq_player_tasks_pair'),
      '缺少 UNIQUE 約束，同一玩家可能有重複的任務進度'
    );
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// MySQL — gift_logs 好友贈幣紀錄表
// ─────────────────────────────────────────────────────────────────────────────
describe('MySQL init.sql — gift_logs 資料表', () => {

  test('應建立 gift_logs 資料表', () => {
    assert.ok(hasTable(mysqlSql, 'gift_logs'), '找不到 gift_logs 資料表');
  });

  test('應包含 sender_id、receiver_id、amount 欄位', () => {
    assert.ok(mysqlSql.includes('sender_id'), 'gift_logs 缺少 sender_id');
    assert.ok(mysqlSql.includes('receiver_id'), 'gift_logs 缺少 receiver_id');
    assert.ok(mysqlSql.includes('amount'), 'gift_logs 缺少 amount');
  });

  test('amount 應有 CHECK 約束確保大於 0', () => {
    assert.ok(
      mysqlSql.includes('chk_gift_logs_amount'),
      'amount 應有 CHECK 約束，不能贈送 0 或負數星幣'
    );
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// MySQL — wallet_transactions（讀庫副本）
// ─────────────────────────────────────────────────────────────────────────────
describe('MySQL init.sql — wallet_transactions 資料表（讀庫副本）', () => {

  test('應建立 wallet_transactions 資料表', () => {
    assert.ok(hasTable(mysqlSql, 'wallet_transactions'), '找不到 wallet_transactions 資料表');
  });

  test('應包含 type 與 sub_type 欄位', () => {
    assert.ok(mysqlSql.includes('sub_type'), 'wallet_transactions 缺少 sub_type 欄位');
  });

  test('type 應有 CHECK 約束（DEBIT / CREDIT / BONUS）', () => {
    assert.ok(
      mysqlSql.includes('chk_wt_type'),
      'type 欄位應限制只能是 DEBIT、CREDIT 或 BONUS'
    );
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// PostgreSQL — wallets 錢包主表
// ─────────────────────────────────────────────────────────────────────────────
describe('PostgreSQL init.sql — wallets 資料表', () => {

  test('應建立 wallets 資料表', () => {
    assert.ok(hasTable(postgresSql, 'wallets'), '找不到 wallets 資料表');
  });

  test('應包含 balance、frozen_amount、version 欄位', () => {
    assert.ok(postgresSql.includes('balance'), 'wallets 缺少 balance 欄位');
    assert.ok(postgresSql.includes('frozen_amount'), 'wallets 缺少 frozen_amount 欄位');
    assert.ok(postgresSql.includes('version'), 'wallets 缺少 version 欄位（樂觀鎖）');
  });

  test('balance 應有 CHECK 約束確保不為負數', () => {
    assert.ok(
      postgresSql.includes('chk_wallets_balance'),
      'balance 應有 CHECK 約束，星幣不能為負數'
    );
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// PostgreSQL — wallet_transactions（寫庫主表）
// ─────────────────────────────────────────────────────────────────────────────
describe('PostgreSQL init.sql — wallet_transactions 資料表（寫庫）', () => {

  test('應建立 wallet_transactions 資料表', () => {
    assert.ok(hasTable(postgresSql, 'wallet_transactions'), '找不到 wallet_transactions 資料表');
  });

  test('id 應使用 BIGSERIAL（PostgreSQL 自動遞增）', () => {
    assert.ok(postgresSql.includes('bigserial'), 'id 應使用 BIGSERIAL');
  });

  test('idempotency_key 應有 UNIQUE 約束（防止重複入帳）', () => {
    assert.ok(
      postgresSql.includes('idempotency_key') && postgresSql.includes('unique'),
      'idempotency_key 缺少 UNIQUE 約束，可能造成重複扣款或加款'
    );
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// PostgreSQL — game_rounds 遊戲對局紀錄
// ─────────────────────────────────────────────────────────────────────────────
describe('PostgreSQL init.sql — game_rounds 資料表', () => {

  test('應建立 game_rounds 資料表', () => {
    assert.ok(hasTable(postgresSql, 'game_rounds'), '找不到 game_rounds 資料表');
  });

  test('應包含 Provably Fair 所需欄位（server_seed、server_seed_hash、client_seed）', () => {
    assert.ok(postgresSql.includes('server_seed'), 'game_rounds 缺少 server_seed');
    assert.ok(postgresSql.includes('server_seed_hash'), 'game_rounds 缺少 server_seed_hash');
    assert.ok(postgresSql.includes('client_seed'), 'game_rounds 缺少 client_seed');
  });

  test('round_id 應有 UNIQUE 約束', () => {
    assert.ok(
      postgresSql.includes('uq_game_round_id'),
      'round_id 缺少 UNIQUE 約束'
    );
  });

  test('game_type 應有 CHECK 約束（SLOT / BACCARAT）', () => {
    assert.ok(
      postgresSql.includes('chk_gr_game_type'),
      'game_type 應限制只能是 SLOT 或 BACCARAT'
    );
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// PostgreSQL — 其他資料表存在性確認
// ─────────────────────────────────────────────────────────────────────────────
describe('PostgreSQL init.sql — 其他資料表', () => {

  test('應建立 rank_history 排行榜歷史快照表', () => {
    assert.ok(hasTable(postgresSql, 'rank_history'), '找不到 rank_history 資料表');
  });

  test('應建立 rank_daily_snapshots 每日持幣量快照表', () => {
    assert.ok(hasTable(postgresSql, 'rank_daily_snapshots'), '找不到 rank_daily_snapshots 資料表');
  });

  test('應建立 game_rtp_stats RTP 統計表', () => {
    assert.ok(hasTable(postgresSql, 'game_rtp_stats'), '找不到 game_rtp_stats 資料表');
  });

  test('應建立 admin_alerts 異常告警表', () => {
    assert.ok(hasTable(postgresSql, 'admin_alerts'), '找不到 admin_alerts 資料表');
  });

  test('admin_alerts 的 alert_type 應有 CHECK 約束', () => {
    assert.ok(
      postgresSql.includes('chk_alert_type'),
      'alert_type 應限制只能是 BIG_WIN、HIGH_FREQUENCY 或 ABNORMAL_TRANSFER'
    );
  });

});
