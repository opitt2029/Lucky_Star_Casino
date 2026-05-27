/**
 * database.test.js
 *
 * 測試資料庫初始化 SQL 檔案是否正確：
 * - MySQL init.sql 建立資料庫與 health check 資料表
 * - PostgreSQL init.sql 建立 health check 資料表
 * - 兩個資料表都有必要的欄位（id、service_name、status、checked_at）
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
// 測試群組：MySQL init.sql
// ─────────────────────────────────────────────────────────────────────────────
describe('MySQL init.sql', () => {

  test('應建立 lucky_star_casino 資料庫', () => {
    assert.ok(
      mysqlSql.includes('create database'),
      'MySQL init.sql 應包含 CREATE DATABASE 語句'
    );
    assert.ok(
      mysqlSql.includes('lucky_star_casino'),
      'MySQL init.sql 應建立 lucky_star_casino 資料庫'
    );
  });

  test('建立資料庫應使用 IF NOT EXISTS 避免重複建立時出錯', () => {
    assert.ok(
      mysqlSql.includes('create database if not exists'),
      '建立資料庫應加上 IF NOT EXISTS，避免重複執行時報錯'
    );
  });

  test('應建立 system_health_check 資料表', () => {
    assert.ok(
      mysqlSql.includes('system_health_check'),
      '找不到 system_health_check 資料表，這是目前唯一的基礎表'
    );
  });

  test('建立資料表應使用 IF NOT EXISTS', () => {
    assert.ok(
      mysqlSql.includes('create table if not exists'),
      '建立資料表應加上 IF NOT EXISTS，避免重複執行時報錯'
    );
  });

  test('system_health_check 應包含 id 欄位', () => {
    assert.ok(mysqlSql.includes('id '), 'system_health_check 缺少 id 欄位');
  });

  test('system_health_check 應包含 service_name 欄位', () => {
    assert.ok(
      mysqlSql.includes('service_name'),
      'system_health_check 缺少 service_name 欄位'
    );
  });

  test('system_health_check 應包含 status 欄位', () => {
    assert.ok(
      mysqlSql.includes('status'),
      'system_health_check 缺少 status 欄位'
    );
  });

  test('system_health_check 應包含 checked_at 欄位', () => {
    assert.ok(
      mysqlSql.includes('checked_at'),
      'system_health_check 缺少 checked_at 欄位'
    );
  });

  test('id 欄位應設為主鍵（PRIMARY KEY）', () => {
    assert.ok(
      mysqlSql.includes('primary key'),
      'id 欄位應設定為 PRIMARY KEY'
    );
  });

  test('id 欄位應為自動遞增（AUTO_INCREMENT）', () => {
    assert.ok(
      mysqlSql.includes('auto_increment'),
      'id 欄位應設定 AUTO_INCREMENT，讓 ID 自動產生不需手動填入'
    );
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// 測試群組：PostgreSQL init.sql
// ─────────────────────────────────────────────────────────────────────────────
describe('PostgreSQL init.sql', () => {

  test('應建立 system_health_check 資料表', () => {
    assert.ok(
      postgresSql.includes('system_health_check'),
      '找不到 system_health_check 資料表'
    );
  });

  test('建立資料表應使用 IF NOT EXISTS', () => {
    assert.ok(
      postgresSql.includes('create table if not exists'),
      '建立資料表應加上 IF NOT EXISTS'
    );
  });

  test('應包含 service_name 欄位', () => {
    assert.ok(
      postgresSql.includes('service_name'),
      'system_health_check 缺少 service_name 欄位'
    );
  });

  test('應包含 status 欄位', () => {
    assert.ok(
      postgresSql.includes('status'),
      'system_health_check 缺少 status 欄位'
    );
  });

  test('應包含 checked_at 欄位', () => {
    assert.ok(
      postgresSql.includes('checked_at'),
      'system_health_check 缺少 checked_at 欄位'
    );
  });

  test('id 欄位應使用 BIGSERIAL（PostgreSQL 自動遞增語法）', () => {
    assert.ok(
      postgresSql.includes('bigserial'),
      'PostgreSQL 的自動遞增應使用 BIGSERIAL，不是 MySQL 的 AUTO_INCREMENT'
    );
  });

  test('id 欄位應設為主鍵', () => {
    assert.ok(
      postgresSql.includes('primary key'),
      'id 欄位應設定為 PRIMARY KEY'
    );
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// 測試群組：MySQL vs PostgreSQL 欄位一致性
// 兩個資料庫的同名表，欄位定義應該對得起來
// ─────────────────────────────────────────────────────────────────────────────
describe('MySQL 與 PostgreSQL 欄位一致性', () => {

  const requiredColumns = ['service_name', 'status', 'checked_at'];

  for (const column of requiredColumns) {
    test(`兩個資料庫的 system_health_check 都應包含 ${column} 欄位`, () => {
      assert.ok(
        mysqlSql.includes(column),
        `MySQL init.sql 的 system_health_check 缺少 ${column} 欄位`
      );
      assert.ok(
        postgresSql.includes(column),
        `PostgreSQL init.sql 的 system_health_check 缺少 ${column} 欄位`
      );
    });
  }

});
