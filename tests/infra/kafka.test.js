/**
 * kafka.test.js
 *
 * 測試 kafka/kafka-init.sh 的設定是否完整：
 * - 所有預期的 Kafka topics 都有被建立
 * - topics 的數量正確
 * - 腳本有正確的錯誤處理（set -euo pipefail）
 * - 連線目標正確（lucky-star-kafka）
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');

const kafkaScript = readFileSync(resolve(ROOT, 'kafka/kafka-init.sh'), 'utf-8');

// 根據 PROJECT_BASE_EXPLANATION.md 定義的預期 topics
const EXPECTED_TOPICS = [
  'member.registered', // 會員註冊完成事件
  'wallet.debit',      // 錢包扣款事件
  'wallet.credit',     // 錢包加款事件
  'game.result',       // 遊戲結果事件
  'rank.update',       // 排行榜更新事件
  'notification.push', // 通知推送事件
];

// ─────────────────────────────────────────────────────────────────────────────
// 測試群組：必要 Topics
// ─────────────────────────────────────────────────────────────────────────────
describe('kafka-init.sh — 必要 Topics', () => {

  for (const topic of EXPECTED_TOPICS) {
    test(`應建立 topic：${topic}`, () => {
      assert.ok(
        kafkaScript.includes(`"${topic}"`),
        `kafka-init.sh 中找不到 topic "${topic}"，請確認有加入 topics 陣列`
      );
    });
  }

  test(`topics 總數應為 ${EXPECTED_TOPICS.length} 個`, () => {
    // 計算腳本裡帶引號的 topic 字串數量
    const topicMatches = kafkaScript.match(/"[\w.]+"/g) || [];
    assert.strictEqual(
      topicMatches.length,
      EXPECTED_TOPICS.length,
      `預期 ${EXPECTED_TOPICS.length} 個 topic，實際找到 ${topicMatches.length} 個`
    );
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// 測試群組：腳本安全性設定
// ─────────────────────────────────────────────────────────────────────────────
describe('kafka-init.sh — 腳本安全性', () => {

  test('應使用 set -euo pipefail（遇到錯誤立即停止）', () => {
    assert.ok(
      kafkaScript.includes('set -euo pipefail'),
      [
        '腳本缺少 "set -euo pipefail"',
        '這行的作用：',
        '  -e：任何指令失敗就停止腳本',
        '  -u：使用未定義的變數時報錯',
        '  -o pipefail：管線中的錯誤也會被捕捉',
      ].join('\n')
    );
  });

  test('應是 bash 腳本（#!/bin/bash）', () => {
    assert.ok(
      kafkaScript.startsWith('#!/bin/bash'),
      '腳本第一行應為 #!/bin/bash，明確指定使用 bash 執行'
    );
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// 測試群組：連線設定
// ─────────────────────────────────────────────────────────────────────────────
describe('kafka-init.sh — 連線設定', () => {

  test('應連線到 lucky-star-kafka（Docker 內部 hostname）', () => {
    assert.ok(
      kafkaScript.includes('lucky-star-kafka'),
      '腳本應連線到 lucky-star-kafka（Docker 網路內部的服務名稱）'
    );
  });

  test('應使用 --if-not-exists 避免重複建立 topic 時出錯', () => {
    assert.ok(
      kafkaScript.includes('--if-not-exists'),
      '建立 topic 應加上 --if-not-exists，避免重複執行時報錯'
    );
  });

  test('應設定 replication-factor（容錯備份數量）', () => {
    assert.ok(
      kafkaScript.includes('--replication-factor'),
      '建立 topic 時應指定 --replication-factor'
    );
  });

  test('應設定 partitions（分區數量）', () => {
    assert.ok(
      kafkaScript.includes('--partitions'),
      '建立 topic 時應指定 --partitions'
    );
  });

});
