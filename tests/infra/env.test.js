/**
 * env.test.js
 *
 * 測試 .env.example 是否包含所有必要的環境變數：
 * - 資料庫連線設定（MySQL、PostgreSQL、Redis）
 * - Kafka 與 Kafka UI 的 port
 * - 所有後端服務的 port
 * - 前端的 port
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');

const envContent = readFileSync(resolve(ROOT, '.env.example'), 'utf-8');

// ─────────────────────────────────────────────────────────────────────────────
// 輔助函式：解析 .env 格式 → 回傳 { KEY: VALUE } 的物件
// ─────────────────────────────────────────────────────────────────────────────
function parseEnv(content) {
  const result = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    // 略過空行與註解行（以 # 開頭）
    if (!trimmed || trimmed.startsWith('#')) continue;
    const [key, ...valueParts] = trimmed.split('=');
    result[key.trim()] = valueParts.join('=').trim();
  }
  return result;
}

const env = parseEnv(envContent);

// ─────────────────────────────────────────────────────────────────────────────
// 測試群組：MySQL 設定
// ─────────────────────────────────────────────────────────────────────────────
describe('.env.example — MySQL 設定', () => {

  const mysqlVars = [
    'MYSQL_ROOT_PASSWORD',
    'MYSQL_DATABASE',
    'MYSQL_USER',
    'MYSQL_PASSWORD',
    'MYSQL_PORT',
  ];

  for (const varName of mysqlVars) {
    test(`應包含 ${varName}`, () => {
      assert.ok(
        varName in env,
        `找不到 ${varName}，MySQL 連線需要這個變數`
      );
      assert.ok(
        env[varName].length > 0,
        `${varName} 不能是空值`
      );
    });
  }

  test('MYSQL_PORT 應為數字字串', () => {
    const port = Number(env['MYSQL_PORT']);
    assert.ok(!isNaN(port) && port > 0, `MYSQL_PORT 應為正整數，目前值為：${env['MYSQL_PORT']}`);
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// 測試群組：PostgreSQL 設定
// ─────────────────────────────────────────────────────────────────────────────
describe('.env.example — PostgreSQL 設定', () => {

  const postgresVars = [
    'POSTGRES_DB',
    'POSTGRES_USER',
    'POSTGRES_PASSWORD',
    'POSTGRES_PORT',
  ];

  for (const varName of postgresVars) {
    test(`應包含 ${varName}`, () => {
      assert.ok(varName in env, `找不到 ${varName}，PostgreSQL 連線需要這個變數`);
      assert.ok(env[varName].length > 0, `${varName} 不能是空值`);
    });
  }

  test('POSTGRES_PORT 應為數字字串', () => {
    const port = Number(env['POSTGRES_PORT']);
    assert.ok(!isNaN(port) && port > 0, `POSTGRES_PORT 應為正整數，目前值為：${env['POSTGRES_PORT']}`);
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// 測試群組：Redis 設定
// ─────────────────────────────────────────────────────────────────────────────
describe('.env.example — Redis 設定', () => {

  test('應包含 REDIS_PORT', () => {
    assert.ok('REDIS_PORT' in env, '找不到 REDIS_PORT');
    assert.ok(env['REDIS_PORT'].length > 0, 'REDIS_PORT 不能是空值');
  });

  test('REDIS_PORT 應為數字字串', () => {
    const port = Number(env['REDIS_PORT']);
    assert.ok(!isNaN(port) && port > 0, `REDIS_PORT 應為正整數，目前值為：${env['REDIS_PORT']}`);
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// 測試群組：Kafka 設定
// ─────────────────────────────────────────────────────────────────────────────
describe('.env.example — Kafka 設定', () => {

  test('應包含 KAFKA_PORT', () => {
    assert.ok('KAFKA_PORT' in env, '找不到 KAFKA_PORT');
  });

  test('應包含 KAFKA_UI_PORT', () => {
    assert.ok('KAFKA_UI_PORT' in env, '找不到 KAFKA_UI_PORT');
  });

  test('KAFKA_PORT 應為數字字串', () => {
    const port = Number(env['KAFKA_PORT']);
    assert.ok(!isNaN(port) && port > 0, `KAFKA_PORT 應為正整數，目前值為：${env['KAFKA_PORT']}`);
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// 測試群組：後端服務 Port
// ─────────────────────────────────────────────────────────────────────────────
describe('.env.example — 後端服務 Port', () => {

  const servicePortVars = [
    ['GATEWAY_PORT', 'API Gateway'],
    ['MEMBER_SERVICE_PORT', 'Member Service'],
    ['WALLET_SERVICE_PORT', 'Wallet Service'],
    ['GAME_SERVICE_PORT', 'Game Service'],
    ['RANK_SERVICE_PORT', 'Rank Service'],
    ['ADMIN_SERVICE_PORT', 'Admin Service'],
  ];

  for (const [varName, serviceName] of servicePortVars) {
    test(`應包含 ${varName}（${serviceName} 的 port）`, () => {
      assert.ok(varName in env, `找不到 ${varName}（${serviceName} 需要這個 port 設定）`);
      const port = Number(env[varName]);
      assert.ok(!isNaN(port) && port > 0, `${varName} 應為正整數，目前值為：${env[varName]}`);
    });
  }

});

// ─────────────────────────────────────────────────────────────────────────────
// 測試群組：前端設定
// ─────────────────────────────────────────────────────────────────────────────
describe('.env.example — 前端設定', () => {

  test('應包含 FRONTEND_PORT', () => {
    assert.ok('FRONTEND_PORT' in env, '找不到 FRONTEND_PORT');
  });

  test('FRONTEND_PORT 應為數字字串', () => {
    const port = Number(env['FRONTEND_PORT']);
    assert.ok(!isNaN(port) && port > 0, `FRONTEND_PORT 應為正整數，目前值為：${env['FRONTEND_PORT']}`);
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// 測試群組：Port 不應互相衝突
// ─────────────────────────────────────────────────────────────────────────────
describe('.env.example — Port 衝突檢查', () => {

  test('所有服務的 port 應該各不相同', () => {
    const portVars = [
      'MYSQL_PORT', 'POSTGRES_PORT', 'REDIS_PORT',
      'KAFKA_PORT', 'KAFKA_UI_PORT', 'FRONTEND_PORT',
      'GATEWAY_PORT', 'MEMBER_SERVICE_PORT', 'WALLET_SERVICE_PORT',
      'GAME_SERVICE_PORT', 'RANK_SERVICE_PORT', 'ADMIN_SERVICE_PORT',
    ];

    // 收集所有有值的 port
    const ports = portVars
      .filter((v) => v in env && env[v])
      .map((v) => env[v]);

    // 用 Set 去重複，如果長度相同代表沒有衝突
    const uniquePorts = new Set(ports);

    assert.strictEqual(
      uniquePorts.size,
      ports.length,
      `有 Port 衝突！所有 port 值：${ports.join(', ')}`
    );
  });

});
