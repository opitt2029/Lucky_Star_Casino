/**
 * docker-compose.test.js
 *
 * 測試 docker-compose.yml 的設定是否完整：
 * - 必要服務是否存在
 * - 各服務是否設定了 healthcheck
 * - 網路與 volume 是否定義
 * - 所有服務是否使用同一個網路
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// 取得專案根目錄的路徑
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');

// 讀取 docker-compose.yml 的原始文字
const composeContent = readFileSync(resolve(ROOT, 'docker-compose.yml'), 'utf-8');

// ─────────────────────────────────────────────────────────────────────────────
// 輔助函式：檢查某個服務名稱是否出現在 yml 裡
// ─────────────────────────────────────────────────────────────────────────────
function hasService(serviceName) {
  // YAML 格式：服務名稱會以 "  serviceName:" 的格式出現（縮排兩格）
  return composeContent.includes(`  ${serviceName}:`);
}

// ─────────────────────────────────────────────────────────────────────────────
// 測試群組：必要服務
// ─────────────────────────────────────────────────────────────────────────────
describe('docker-compose.yml — 必要服務', () => {

  test('應包含 mysql 服務', () => {
    assert.ok(hasService('mysql'), '找不到 mysql 服務，請確認 docker-compose.yml 有定義 mysql');
  });

  test('應包含 postgres 服務', () => {
    assert.ok(hasService('postgres'), '找不到 postgres 服務，請確認 docker-compose.yml 有定義 postgres');
  });

  test('應包含 redis 服務', () => {
    assert.ok(hasService('redis'), '找不到 redis 服務，請確認 docker-compose.yml 有定義 redis');
  });

  test('應包含 zookeeper 服務', () => {
    assert.ok(hasService('zookeeper'), '找不到 zookeeper 服務，Kafka 需要 zookeeper 才能運作');
  });

  test('應包含 kafka 服務', () => {
    assert.ok(hasService('kafka'), '找不到 kafka 服務，請確認 docker-compose.yml 有定義 kafka');
  });

  test('應包含 kafka-init 服務（負責建立 topics）', () => {
    assert.ok(hasService('kafka-init'), '找不到 kafka-init 服務，Kafka topics 將無法自動建立');
  });

  test('應包含 kafka-ui 服務', () => {
    assert.ok(hasService('kafka-ui'), '找不到 kafka-ui 服務，請確認 docker-compose.yml 有定義 kafka-ui');
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// 測試群組：healthcheck 設定
// healthcheck 讓 Docker 能判斷服務是否「真的可用」而非只是容器已啟動
// ─────────────────────────────────────────────────────────────────────────────
describe('docker-compose.yml — healthcheck 設定', () => {

  test('應有至少 4 個 healthcheck 設定（mysql/postgres/redis/kafka）', () => {
    // 計算 healthcheck 出現次數
    const count = (composeContent.match(/healthcheck:/g) || []).length;
    assert.ok(
      count >= 4,
      `healthcheck 只設定了 ${count} 個，預期至少 4 個（mysql、postgres、redis、kafka）`
    );
  });

  test('mysql 服務應設定 healthcheck', () => {
    // 確認 mysql 區塊後面有 healthcheck
    assert.ok(
      composeContent.includes('mysqladmin ping'),
      'mysql healthcheck 應使用 mysqladmin ping 指令'
    );
  });

  test('postgres 服務應設定 healthcheck', () => {
    assert.ok(
      composeContent.includes('pg_isready'),
      'postgres healthcheck 應使用 pg_isready 指令'
    );
  });

  test('redis 服務應設定 healthcheck', () => {
    // YAML 陣列格式：["CMD", "redis-cli", "ping"]，所以搜尋 redis-cli 即可
    assert.ok(
      composeContent.includes('redis-cli'),
      'redis healthcheck 應使用 redis-cli 指令'
    );
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// 測試群組：網路與 volume
// ─────────────────────────────────────────────────────────────────────────────
describe('docker-compose.yml — 網路與 Volume', () => {

  test('應定義 lucky-network 網路', () => {
    assert.ok(
      composeContent.includes('lucky-network'),
      '找不到 lucky-network，服務之間需要共用同一個網路才能互相溝通'
    );
  });

  test('應定義 MySQL 的 volume（lucky_mysql80_data）', () => {
    assert.ok(
      composeContent.includes('lucky_mysql80_data'),
      '找不到 lucky_mysql80_data volume，容器重啟後資料會遺失'
    );
  });

  test('應定義 PostgreSQL 的 volume（lucky_postgres_data）', () => {
    assert.ok(
      composeContent.includes('lucky_postgres_data'),
      '找不到 lucky_postgres_data volume，容器重啟後資料會遺失'
    );
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// 測試群組：Port 使用環境變數（不寫死）
// ─────────────────────────────────────────────────────────────────────────────
describe('docker-compose.yml — Port 設定', () => {

  test('MySQL port 應使用環境變數 ${MYSQL_PORT}', () => {
    assert.ok(
      composeContent.includes('${MYSQL_PORT}'),
      'MySQL port 應使用 ${MYSQL_PORT} 環境變數，不應直接寫死數字'
    );
  });

  test('Kafka port 應使用環境變數 ${KAFKA_PORT}', () => {
    assert.ok(
      composeContent.includes('${KAFKA_PORT}'),
      'Kafka port 應使用 ${KAFKA_PORT} 環境變數，不應直接寫死數字'
    );
  });

  test('Kafka UI port 應使用環境變數 ${KAFKA_UI_PORT}', () => {
    assert.ok(
      composeContent.includes('${KAFKA_UI_PORT}'),
      'Kafka UI port 應使用 ${KAFKA_UI_PORT} 環境變數，不應直接寫死數字'
    );
  });

});
