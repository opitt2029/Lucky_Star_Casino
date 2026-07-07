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

  test('應包含 kafka 服務', () => {
    assert.ok(hasService('kafka'), '找不到 kafka 服務，請確認 docker-compose.yml 有定義 kafka');
  });

  test('Kafka 應使用 KRaft 模式（不得再有 zookeeper 服務）', () => {
    // T-002：Kafka 7.6.1 採 KRaft（broker+controller 合一），移除 Zookeeper
    assert.ok(
      !hasService('zookeeper'),
      'KRaft 模式不應再定義 zookeeper 服務（規格要求無 Zookeeper）'
    );
    assert.ok(
      composeContent.includes('KAFKA_PROCESS_ROLES'),
      'Kafka 應設定 KAFKA_PROCESS_ROLES（KRaft 模式必要設定）'
    );
    assert.ok(
      composeContent.includes('KAFKA_CONTROLLER_QUORUM_VOTERS'),
      'Kafka 應設定 KAFKA_CONTROLLER_QUORUM_VOTERS（KRaft 模式必要設定）'
    );
  });

  test('應包含 kafka-init 服務（負責建立 topics）', () => {
    assert.ok(hasService('kafka-init'), '找不到 kafka-init 服務，Kafka topics 將無法自動建立');
  });

  test('應包含 kafka-ui 服務', () => {
    assert.ok(hasService('kafka-ui'), '找不到 kafka-ui 服務，請確認 docker-compose.yml 有定義 kafka-ui');
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// 測試群組：後端服務（已全面容器化，取代各自 mvn spring-boot:run 開視窗）
// ─────────────────────────────────────────────────────────────────────────────
describe('docker-compose.yml — 後端服務容器化', () => {

  const backendServices = [
    'gateway-service',
    'member-service',
    'wallet-service',
    'game-service',
    'rank-service',
    'admin-service',
    'notification-service',
  ];

  for (const service of backendServices) {
    test(`應包含 ${service} 服務`, () => {
      assert.ok(hasService(service), `找不到 ${service} 服務，請確認 docker-compose.yml 有定義 ${service}`);
    });
  }

  test('每個後端服務都應指向自己的 Dockerfile', () => {
    for (const service of backendServices) {
      assert.ok(
        composeContent.includes(`backend/${service}/Dockerfile`),
        `${service} 應在 docker-compose.yml 指向 backend/${service}/Dockerfile`
      );
    }
  });

  test('每個後端服務都應設定 actuator healthcheck', () => {
    const count = (composeContent.match(/healthcheck:/g) || []).length;
    assert.ok(
      count >= 4 + backendServices.length,
      `healthcheck 只設定了 ${count} 個，預期至少 ${4 + backendServices.length} 個（4 infra + 7 後端）`
    );
    assert.ok(
      composeContent.includes('/actuator/health'),
      '後端服務 healthcheck 應打 actuator health 端點'
    );
  });

  test('容器內部 Kafka 連線應使用內部 listener（非 localhost）', () => {
    assert.ok(
      composeContent.includes('KAFKA_BOOTSTRAP_SERVERS: lucky-star-kafka:29092'),
      '後端服務容器應以 lucky-star-kafka:29092（內部 listener）連 Kafka，而非 localhost:9092（host-only listener）'
    );
  });

  test('game-service 應等待 wallet-service healthy 才啟動', () => {
    assert.ok(
      /game-service:[\s\S]*?depends_on:[\s\S]*?wallet-service:/.test(composeContent),
      'game-service 呼叫 wallet-service，應在 depends_on 中等待其 healthy'
    );
  });

  test('gateway-service 應等待其餘 6 個後端服務 healthy 才啟動', () => {
    const gatewayBlockMatch = composeContent.match(/ {2}gateway-service:\s*\n[\s\S]*?(?=\n {2}\S|\nvolumes:)/);
    assert.ok(gatewayBlockMatch, '找不到 gateway-service 區塊');
    const gatewayBlock = gatewayBlockMatch[0];
    for (const service of backendServices.filter((s) => s !== 'gateway-service')) {
      assert.ok(
        gatewayBlock.includes(`${service}:`),
        `gateway-service 的 depends_on 應包含 ${service}`
      );
    }
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
// 測試群組：觀測性（選配 profile，T-090）
// prometheus/grafana 必須綁在 observability profile 之下，
// 確保預設 `docker compose up` 行為不變（只起基礎設施）
// ─────────────────────────────────────────────────────────────────────────────
describe('docker-compose.yml — 觀測性 profile', () => {

  test('應定義 prometheus 服務', () => {
    assert.ok(
      hasService('prometheus'),
      '找不到 prometheus 服務，觀測性 profile（--profile observability）需要它'
    );
  });

  test('應定義 grafana 服務', () => {
    assert.ok(
      hasService('grafana'),
      '找不到 grafana 服務，觀測性 profile（--profile observability）需要它'
    );
  });

  test('prometheus/grafana 應綁定 observability profile（預設 up 不啟動）', () => {
    const count = (composeContent.match(/profiles: \["observability"\]/g) || []).length;
    assert.strictEqual(
      count, 2,
      `observability profile 應恰好出現 2 次（prometheus、grafana），實際 ${count} 次；` +
      '若拿掉 profile，預設 docker compose up 會多起監控容器、破壞 DEPLOY.md SOP'
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
