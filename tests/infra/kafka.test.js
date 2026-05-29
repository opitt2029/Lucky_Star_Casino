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

// 一般業務 topics
const EXPECTED_TOPICS = [
  'member.registered',     // 會員註冊完成事件
  'wallet.debit',          // 錢包扣款事件（事件：已扣款）
  'wallet.credit.request', // 入帳指令（請入帳，member 發；ADR-002）
  'wallet.credit',         // 錢包加款事件（事件：已入帳）
  'game.result',           // 遊戲結果事件
  'rank.update',           // 排行榜更新事件
  'notification.push',     // 通知推送事件
];

// Dead Letter Topics（處理失敗後的備援 topic）
const EXPECTED_DLT_TOPICS = [
  'wallet.debit.DLT',          // 扣款失敗事件
  'wallet.credit.DLT',         // 加款失敗事件
  'wallet.credit.request.DLT', // 入帳指令失敗（ADR-002）
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

  test(`一般 topics 總數應為 ${EXPECTED_TOPICS.length} 個`, () => {
    // 計算腳本裡帶引號且不含 DLT 的 topic 字串數量
    const allMatches = kafkaScript.match(/"[\w.]+"/g) || [];
    const regularTopics = allMatches.filter((t) => !t.includes('DLT'));
    assert.strictEqual(
      regularTopics.length,
      EXPECTED_TOPICS.length,
      `預期 ${EXPECTED_TOPICS.length} 個一般 topic，實際找到 ${regularTopics.length} 個`
    );
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// 測試群組：Dead Letter Topics（DLT）
// DLT 是 Kafka 的錯誤處理機制：事件處理失敗多次後，會被送到 DLT 保留，讓工程師後續排查
// ─────────────────────────────────────────────────────────────────────────────
describe('kafka-init.sh — Dead Letter Topics', () => {

  for (const topic of EXPECTED_DLT_TOPICS) {
    test(`應建立 DLT topic：${topic}`, () => {
      assert.ok(
        kafkaScript.includes(`"${topic}"`),
        `kafka-init.sh 中找不到 DLT topic "${topic}"`
      );
    });
  }

  test(`DLT topics 總數應為 ${EXPECTED_DLT_TOPICS.length} 個`, () => {
    const allMatches = kafkaScript.match(/"[\w.]+"/g) || [];
    const dltTopics = allMatches.filter((t) => t.includes('DLT'));
    assert.strictEqual(
      dltTopics.length,
      EXPECTED_DLT_TOPICS.length,
      `預期 ${EXPECTED_DLT_TOPICS.length} 個 DLT topic，實際找到 ${dltTopics.length} 個`
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
