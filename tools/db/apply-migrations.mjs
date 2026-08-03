#!/usr/bin/env node
/**
 * 資料庫 migration 自動補跑工具（修 AGENTS.md 雷區 26）。
 *
 * ## 為什麼需要這支工具
 *
 * `database/{mysql,postgres}/init.sql` **只在 Docker volume 全新時**由官方 image 的
 * entrypoint 執行；既有 volume 一律不跑。所以 `git pull` 拿到新 schema 之後，
 * 本機的舊 volume 沒有新表/新欄位，服務會 `Schema-validation: missing table/column`
 * 無限重啟，並讓 `depends_on: service_healthy` 的下游服務永遠停在 Created。
 *
 * 專案沒有 Flyway runtime，DEPLOY.md 原本要人「自己判斷哪幾支還沒跑、依編號手動套」——
 * 判斷錯就漏套或重複套。本工具把這件事自動化。
 *
 * ## 設計：ledger + 逐語句 + 「已套用類」錯誤跳過
 *
 * 1. **ledger 表 `schema_migrations`**：記錄哪些檔案套過。第二次執行就是 no-op。
 *    這張表由本工具建立，不在 init.sql 裡——舊 volume 本來就沒有它，
 *    所以「ledger 是空的」不代表「一支都沒套過」（見第 3 點）。
 *
 * 2. **逐語句執行，不整檔灌**：migration 檔多半不冪等（MySQL 沒有
 *    `ADD COLUMN IF NOT EXISTS`、`CREATE INDEX` 也不能 IF NOT EXISTS）。整檔灌下去，
 *    第一句撞到「已存在」就整檔失敗，後面真正缺的語句反而沒跑。
 *    逐語句送出後，DDL 各自 autocommit，失敗一句不影響其他句。
 *    （PostgreSQL 的 DDL 是交易式的，一句錯會 abort 整個交易 → 更必須逐句送，
 *    否則同一交易內後續語句全被 25P02 連坐。）
 *
 * 3. **「已套用類」錯誤視為跳過，其他錯誤中止**：首次對舊 volume 執行時 ledger 是空的，
 *    工具會從 V1 重跑一輪；已經存在的東西會回報「duplicate column」「table exists」之類
 *    的錯誤碼，這些是預期內的，記為 skipped 繼續。真正的錯誤（語法錯、缺前置表、
 *    權限不足）不在白名單內，直接中止並印出原始 SQL 與錯誤訊息。
 *    每一句被跳過的語句都會印出來，不會靜默。
 *
 * 這個「重跑一輪、已存在就跳過」的 baseline 行為，也讓全新 volume 能安全執行：
 * init.sql 已經建好的東西全部落在跳過分支，結果只是把 ledger 補齊。
 *
 * ## 約束重播（這支工具最微妙的一點，改動前務必讀完）
 *
 * `chk_wt_sub_type` 這類 CHECK 約束的擴充手法是「DROP 舊的 → ADD 新的（較寬清單）」，
 * 散落在多支 migration（PG：V4/V11/V12/V13；MySQL：V6/V7/V9/V10）。
 * baseline 重播時，早期那幾支會把約束 DROP 掉、再嘗試 ADD 一個**比現況窄**的清單，
 * 而現有資料已經含有較新的子型（例如 TOPUP）→ 觸發 check violation。
 *
 * 這類錯誤被列為「已套用類」而跳過，靠的是一個前提：
 * **重播一定會跑到最後一支約束 migration，最終生效的就是最寬、也就是正確的那份清單。**
 * 因此：
 *   - 若執行中途因其他錯誤中止，約束可能停在「已 DROP、尚未重建」的狀態。
 *     工具中止時會提醒；**不要放著不管**，修掉根因後重跑，或手動補上最後一支
 *     約束 migration 的 ADD CONSTRAINT。
 *   - 未來若新增 migration 改成「縮窄」約束清單，這個前提就不成立，必須改設計。
 *
 * ## 用法
 *
 *   node tools/db/apply-migrations.mjs --dry-run   # 只列出打算做什麼，不連 DB 寫入
 *   node tools/db/apply-migrations.mjs             # 實際套用
 *   node tools/db/apply-migrations.mjs --only=mysql
 *
 * 需要對應容器正在執行（`docker compose up -d postgres mysql` 即可，
 * 後端服務起不來沒關係——本工具只碰資料庫容器）。
 * 帳密直接從容器的環境變數讀，不解析 `.env`，避免 `.env` 與實際跑著的容器不一致。
 *
 * 環境變數（預設對齊 docker-compose 的 container_name）：
 *   POSTGRES_CONTAINER=lucky-star-postgres
 *   MYSQL_CONTAINER=lucky-star-mysql
 */

import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');

const LEDGER_TABLE = 'schema_migrations';

// ─────────────────────────────────────────────────────────────────────────────
// 「已套用類」錯誤碼白名單
//
// 只列出語意明確是「這個東西已經存在／已經不在了」的碼。像 MySQL 1146
// （table doesn't exist）刻意不列——那代表前置 migration 真的漏了，必須中止讓人看到。
// ─────────────────────────────────────────────────────────────────────────────

/** MySQL 錯誤碼（`ERROR 1060 (42S21) at line 1: ...` 的數字部分） */
const MYSQL_ALREADY_APPLIED = new Set([
  1050, // ER_TABLE_EXISTS_ERROR：表已存在
  1060, // ER_DUP_FIELDNAME：欄位已存在
  1061, // ER_DUP_KEYNAME：索引名稱已存在
  1091, // ER_CANT_DROP_FIELD_OR_KEY：要 DROP 的欄位/約束不存在（DROP CHECK 重跑）
  1054, // ER_BAD_FIELD_ERROR：欄位不存在（如 V4 重跑時 is_active 已被改名/移除）
  1022, // ER_DUP_KEY：鍵重複
  1826, // ER_FK_DUP_NAME：外鍵名稱重複
  3822, // ER_CONSTRAINT_NOT_FOUND 系列：CHECK 約束名稱重複
  1062, // ER_DUP_ENTRY：唯一鍵重複。seed 重跑會撞到（V10 的 shop_items 沒寫
        // ON DUPLICATE KEY UPDATE），對本專案而言就是「這批 seed 已經進去了」。
  3819, // ER_CHECK_CONSTRAINT_VIOLATED：重播舊的 chk_wt_sub_type 時，
        // 現有資料含較新的子型而被較窄的舊清單擋下（見檔頭「約束重播」）。
]);

/** PostgreSQL SQLSTATE（靠 `\set VERBOSITY verbose` 讓 psql 把碼印在訊息裡） */
const POSTGRES_ALREADY_APPLIED = new Set([
  '42P07', // duplicate_table：表或索引已存在
  '42701', // duplicate_column：欄位已存在
  '42710', // duplicate_object：約束等物件已存在
  '42703', // undefined_column：欄位不存在（重跑時已改名/已移除）
  '42P16', // invalid_table_definition
  '23505', // unique_violation：seed 重跑（對應 MySQL 1062，理由見上）
  '23514', // check_violation：重播舊的 chk_wt_sub_type（見檔頭「約束重播」）
]);

// ─────────────────────────────────────────────────────────────────────────────
// SQL 語句切分
//
// 用最小的字元掃描器切 `;`，只需要避開三種「裡面的分號不算分隔」的情境：
// 行註解、區塊註解、單引號字串。專案的 migration 沒有 dollar-quoted（$$）區塊，
// 也沒有 DELIMITER，所以不處理那兩種；未來若有人加了，這裡要一起改。
// 反斜線跳脫也不處理（migration 檔內無反斜線，V11 特意用 hex literal 存中文就是為此）。
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 把一份 SQL 切成多個語句。
 * @param {string} sql
 * @returns {string[]} 已去除空白／純註解的語句（不含結尾分號）
 */
export function splitStatements(sql) {
  const statements = [];
  let current = '';
  let inLineComment = false;
  let inBlockComment = false;
  let inString = false;

  for (let i = 0; i < sql.length; i++) {
    const c = sql[i];
    const next = sql[i + 1];

    if (inLineComment) {
      if (c === '\n') inLineComment = false;
      current += c;
      continue;
    }
    if (inBlockComment) {
      if (c === '*' && next === '/') {
        inBlockComment = false;
        current += '*/';
        i++;
        continue;
      }
      current += c;
      continue;
    }
    if (inString) {
      current += c;
      // 連續兩個單引號是「字串內的一個單引號」，不是結束
      if (c === "'" && next === "'") {
        current += next;
        i++;
        continue;
      }
      if (c === "'") inString = false;
      continue;
    }

    if (c === '-' && next === '-') {
      inLineComment = true;
      current += '--';
      i++;
      continue;
    }
    if (c === '/' && next === '*') {
      inBlockComment = true;
      current += '/*';
      i++;
      continue;
    }
    if (c === "'") {
      inString = true;
      current += c;
      continue;
    }
    if (c === ';') {
      statements.push(current);
      current = '';
      continue;
    }
    current += c;
  }
  statements.push(current);

  return statements.filter((s) => !isBlank(s)).map((s) => s.trim());
}

/** 語句去掉註解後是否為空（純註解或空白不需要送出） */
function isBlank(statement) {
  return (
    statement
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/--[^\n]*/g, '')
      .trim() === ''
  );
}

/**
 * 依檔名的版本號排序 migration 檔（V2 要排在 V10 前面，字串排序會弄反）。
 * @param {string} dir
 * @returns {string[]} 檔名陣列
 */
export function listMigrationFiles(dir) {
  return readdirSync(dir)
    .filter((f) => /^V\d+__.*\.sql$/.test(f))
    .sort((a, b) => versionOf(a) - versionOf(b));
}

function versionOf(filename) {
  return Number(filename.match(/^V(\d+)__/)[1]);
}

// ─────────────────────────────────────────────────────────────────────────────
// 容器互動
// ─────────────────────────────────────────────────────────────────────────────

/** 執行 docker 指令，SQL 用 stdin 以 UTF-8 Buffer 餵入（避免 Windows codepage 破壞中文） */
function dockerExec(args, stdin) {
  return spawnSync('docker', args, {
    input: stdin === undefined ? undefined : Buffer.from(stdin, 'utf8'),
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
}

function containerRunning(name) {
  const r = spawnSync('docker', ['inspect', '-f', '{{.State.Running}}', name], { encoding: 'utf8' });
  return r.status === 0 && r.stdout.trim() === 'true';
}

/** 讀容器內的環境變數，讓帳密以「實際跑著的容器」為準而非 .env */
function containerEnv(name, key) {
  const r = spawnSync('docker', ['exec', name, 'printenv', key], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`讀不到容器 ${name} 的環境變數 ${key}`);
  return r.stdout.trim();
}

// ─────────────────────────────────────────────────────────────────────────────
// 兩種資料庫的差異都收斂在這兩個 adapter 裡
// ─────────────────────────────────────────────────────────────────────────────

function postgresAdapter() {
  const container = process.env.POSTGRES_CONTAINER || 'lucky-star-postgres';
  const user = containerEnv(container, 'POSTGRES_USER');
  const db = containerEnv(container, 'POSTGRES_DB');

  const run = (sql) =>
    dockerExec(
      ['exec', '-i', container, 'psql', '-U', user, '-d', db, '-v', 'ON_ERROR_STOP=1', '-q', '-t', '-A'],
      // VERBOSITY verbose 讓錯誤訊息帶上 SQLSTATE，才能分類是不是「已套用」
      `\\set VERBOSITY verbose\n${sql}\n`
    );

  return {
    name: 'postgres',
    container,
    dir: resolve(ROOT, 'database/postgres/migration'),
    run,
    ledgerDdl: `CREATE TABLE IF NOT EXISTS ${LEDGER_TABLE} (
      filename   VARCHAR(255) NOT NULL PRIMARY KEY,
      applied_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    selectApplied: `SELECT filename FROM ${LEDGER_TABLE}`,
    insertApplied: (f) =>
      `INSERT INTO ${LEDGER_TABLE} (filename) VALUES ('${f}') ON CONFLICT (filename) DO NOTHING`,
    /** 從 psql 的 verbose 錯誤訊息抽出 SQLSTATE，判斷是否屬「已套用」 */
    isAlreadyApplied: (stderr) => {
      const m = stderr.match(/ERROR:\s+([0-9A-Z]{5}):/);
      return m !== null && POSTGRES_ALREADY_APPLIED.has(m[1]);
    },
  };
}

function mysqlAdapter() {
  const container = process.env.MYSQL_CONTAINER || 'lucky-star-mysql';
  const user = containerEnv(container, 'MYSQL_USER');
  const password = containerEnv(container, 'MYSQL_PASSWORD');
  const db = containerEnv(container, 'MYSQL_DATABASE');

  const run = (sql) =>
    dockerExec(
      [
        'exec', '-i', container,
        'mysql', `-u${user}`, `-p${password}`, '--default-character-set=utf8mb4',
        '--silent', '--skip-column-names', db,
      ],
      `${sql};\n`
    );

  return {
    name: 'mysql',
    container,
    dir: resolve(ROOT, 'database/mysql/migration'),
    run,
    ledgerDdl: `CREATE TABLE IF NOT EXISTS ${LEDGER_TABLE} (
      filename   VARCHAR(255) NOT NULL,
      applied_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT pk_schema_migrations PRIMARY KEY (filename)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    selectApplied: `SELECT filename FROM ${LEDGER_TABLE}`,
    insertApplied: (f) => `INSERT IGNORE INTO ${LEDGER_TABLE} (filename) VALUES ('${f}')`,
    isAlreadyApplied: (stderr) => {
      const m = stderr.match(/ERROR\s+(\d+)\s*\(/);
      return m !== null && MYSQL_ALREADY_APPLIED.has(Number(m[1]));
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 主流程
// ─────────────────────────────────────────────────────────────────────────────

/** mysql client 對 stdin 密碼會印警告，不是錯誤，過濾掉免得誤判 */
function meaningfulStderr(stderr) {
  return stderr
    .split('\n')
    .filter((l) => l.trim() !== '' && !l.includes('Using a password on the command line'))
    .join('\n');
}

function query(adapter, sql) {
  const r = adapter.run(sql);
  const err = meaningfulStderr(r.stderr || '');
  if (r.status !== 0 || err.startsWith('ERROR')) {
    throw new Error(`${adapter.name}: 執行失敗\n  SQL: ${sql}\n  ${err}`);
  }
  return r.stdout;
}

function applyDatabase(adapter, { dryRun }) {
  console.log(`\n=== ${adapter.name}（容器 ${adapter.container}）`);

  if (!containerRunning(adapter.container)) {
    throw new Error(
      `容器 ${adapter.container} 沒有在執行。先 \`docker compose up -d ${adapter.name}\` 再重跑。`
    );
  }
  if (!existsSync(adapter.dir)) {
    throw new Error(`找不到 migration 目錄：${adapter.dir}`);
  }

  const files = listMigrationFiles(adapter.dir);

  if (dryRun) {
    console.log(`  [dry-run] 不連線寫入。目錄共 ${files.length} 支 migration：`);
    files.forEach((f) => console.log(`    - ${f}`));
    console.log('  [dry-run] 實際執行時會建立 ledger 表、跳過已記錄的檔案，');
    console.log('            並把「已存在」類錯誤記為 skipped。');
    return { applied: 0, skipped: 0, alreadyRecorded: files.length };
  }

  query(adapter, adapter.ledgerDdl);
  const recorded = new Set(
    query(adapter, adapter.selectApplied)
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
  );

  let appliedCount = 0;
  let skippedCount = 0;

  for (const file of files) {
    if (recorded.has(file)) {
      console.log(`  - ${file}：ledger 已記錄，跳過`);
      continue;
    }

    const sql = readFileSync(resolve(adapter.dir, file), 'utf8');
    const statements = splitStatements(sql);
    let ran = 0;
    let skipped = 0;

    for (const statement of statements) {
      const r = adapter.run(statement);
      const err = meaningfulStderr(r.stderr || '');

      if (r.status === 0 && !err.startsWith('ERROR')) {
        ran++;
        continue;
      }
      if (adapter.isAlreadyApplied(err)) {
        skipped++;
        console.log(`      skip: ${firstLine(statement)}  ←  ${firstLine(err)}`);
        continue;
      }
      throw new Error(
        `${adapter.name}: ${file} 套用失敗（非「已存在」類錯誤，已中止）\n` +
          `  SQL: ${statement}\n  ${err}\n` +
          '  注意：中止點之前的語句已經生效。若失敗發生在約束重播途中，\n' +
          '  CHECK 約束可能停在「已 DROP、尚未重建」的狀態（見本檔頭「約束重播」）。\n' +
          '  修掉上面的根因後重跑本工具即可補上。'
      );
    }

    query(adapter, adapter.insertApplied(file));
    appliedCount += ran;
    skippedCount += skipped;
    console.log(`  ✓ ${file}：執行 ${ran} 句、跳過 ${skipped} 句（已存在）`);
  }

  return { applied: appliedCount, skipped: skippedCount, alreadyRecorded: recorded.size };
}

/** 取一行摘要顯示；語句常以整段註解開頭，先濾掉才看得出真正做了什麼 */
function firstLine(text) {
  const line =
    text
      .split('\n')
      .map((l) => l.trim())
      .find((l) => l !== '' && !l.startsWith('--')) ?? text.trim();
  return line.length > 110 ? `${line.slice(0, 107)}...` : line;
}

function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const onlyArg = args.find((a) => a.startsWith('--only='));
  const only = onlyArg ? onlyArg.split('=')[1] : null;

  if (only && !['mysql', 'postgres'].includes(only)) {
    console.error(`--only 只接受 mysql 或 postgres，收到：${only}`);
    process.exit(2);
  }

  const targets = [];
  if (only !== 'mysql') targets.push(postgresAdapter);
  if (only !== 'postgres') targets.push(mysqlAdapter);

  console.log(dryRun ? 'migration 補跑（dry-run，不寫入）' : 'migration 補跑');

  const totals = { applied: 0, skipped: 0 };
  for (const build of targets) {
    const result = applyDatabase(build(), { dryRun });
    totals.applied += result.applied;
    totals.skipped += result.skipped;
  }

  console.log(
    `\n完成：執行 ${totals.applied} 句、跳過 ${totals.skipped} 句（已存在）。` +
      (dryRun ? '（dry-run）' : ' 接著跑 `docker compose up -d` 讓服務重新啟動。')
  );
}

// 被 import 時（單元測試）不執行主流程
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  try {
    main();
  } catch (e) {
    console.error(`\n✗ ${e.message}`);
    process.exit(1);
  }
}
