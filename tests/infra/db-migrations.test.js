/**
 * db-migrations.test.js
 *
 * 守 `tools/db/apply-migrations.mjs` 兩個最容易默默壞掉的地方：
 *
 *   1. **語句切分**：工具是逐語句送進資料庫的（migration 檔不冪等，整檔灌會被
 *      第一句「已存在」擋掉，後面真正缺的語句就跑不到）。切分若把註解或字串裡的
 *      分號當成分隔，送出去的會是破碎 SQL——而且錯誤訊息會指向奇怪的地方。
 *   2. **版本排序**：字串排序會讓 V10 跑在 V2 前面，前置欄位不存在就整批失敗。
 *
 * 這裡不連資料庫（比照其他 infra 測試的零依賴約定），只測純函式與實際 migration 檔的可解析性。
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { splitStatements, listMigrationFiles } from '../../tools/db/apply-migrations.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');

const MIGRATION_DIRS = [
  resolve(ROOT, 'database/postgres/migration'),
  resolve(ROOT, 'database/mysql/migration'),
];

describe('apply-migrations — 語句切分', () => {

  test('依分號切出多個語句', () => {
    const stmts = splitStatements('SELECT 1; SELECT 2;');
    assert.deepEqual(stmts, ['SELECT 1', 'SELECT 2']);
  });

  test('忽略行註解裡的分號', () => {
    const stmts = splitStatements('-- 註解裡有分號; 不該切\nSELECT 1;');
    assert.equal(stmts.length, 1);
    assert.ok(stmts[0].includes('SELECT 1'));
  });

  test('忽略區塊註解裡的分號', () => {
    const stmts = splitStatements('/* a; b; c */ SELECT 1;');
    assert.equal(stmts.length, 1);
  });

  test('忽略單引號字串裡的分號', () => {
    const stmts = splitStatements("INSERT INTO t (c) VALUES ('a;b');");
    assert.equal(stmts.length, 1);
    assert.ok(stmts[0].includes("'a;b'"));
  });

  test('字串內連續兩個單引號不算字串結束', () => {
    const stmts = splitStatements("INSERT INTO t (c) VALUES ('it''s; fine'); SELECT 2;");
    assert.equal(stmts.length, 2);
  });

  test('純註解與空白不產生語句', () => {
    assert.deepEqual(splitStatements('-- 只有註解\n\n   \n'), []);
  });

  test('最後一句沒有分號也算一句', () => {
    assert.deepEqual(splitStatements('SELECT 1'), ['SELECT 1']);
  });

});

describe('apply-migrations — 版本排序', () => {

  test('依數字排序，V2 必須在 V10 之前', () => {
    for (const dir of MIGRATION_DIRS) {
      const files = listMigrationFiles(dir);
      const versions = files.map((f) => Number(f.match(/^V(\d+)__/)[1]));
      const sorted = [...versions].sort((a, b) => a - b);
      assert.deepEqual(versions, sorted, `${dir} 的 migration 未依版本號排序`);
    }
  });

  test('版本號不得重複（重複代表有人並行加了同號 migration）', () => {
    for (const dir of MIGRATION_DIRS) {
      const versions = listMigrationFiles(dir).map((f) => Number(f.match(/^V(\d+)__/)[1]));
      assert.equal(new Set(versions).size, versions.length, `${dir} 有重複的 migration 版本號`);
    }
  });

});

describe('apply-migrations — 實際 migration 檔可解析', () => {

  test('每支 migration 都能切出至少一句 SQL', () => {
    for (const dir of MIGRATION_DIRS) {
      for (const file of listMigrationFiles(dir)) {
        const sql = readFileSync(resolve(dir, file), 'utf8');
        assert.ok(splitStatements(sql).length > 0, `${file} 切不出任何語句`);
      }
    }
  });

  test('切出的語句不得殘留未閉合的單引號（切分位置錯掉的徵兆）', () => {
    for (const dir of MIGRATION_DIRS) {
      for (const file of listMigrationFiles(dir)) {
        const sql = readFileSync(resolve(dir, file), 'utf8');
        for (const stmt of splitStatements(sql)) {
          // 先移除註解，再數單引號；成對才代表字串沒被從中間切開
          const withoutComments = stmt
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/--[^\n]*/g, '');
          const quotes = (withoutComments.match(/'/g) || []).length;
          assert.equal(quotes % 2, 0, `${file} 有語句的單引號未成對：${stmt.slice(0, 80)}`);
        }
      }
    }
  });

  test('migration 不得含 dollar-quoted 區塊或 DELIMITER（切分器不支援）', () => {
    for (const dir of MIGRATION_DIRS) {
      for (const file of listMigrationFiles(dir)) {
        const sql = readFileSync(resolve(dir, file), 'utf8');
        assert.ok(!sql.includes('$$'), `${file} 含 $$ 區塊，切分器不支援，需先擴充 splitStatements`);
        assert.ok(!/^\s*DELIMITER\b/im.test(sql), `${file} 含 DELIMITER，切分器不支援`);
      }
    }
  });

});
