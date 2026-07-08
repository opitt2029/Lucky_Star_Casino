#!/usr/bin/env node
/**
 * generate-audit-snapshot.mjs — AUDIT_REPORT.md 附錄 A 自動盤點
 *
 * 為什麼要這個工具？
 *   附錄 A 過去靠人記得去盤點，會落後實際程式碼（T-027/T-028 早已併入卻長期標 ❌/⚠️，
 *   見 AGENTS.md §1 的告示）。改為每次執行時對「當下工作樹 + git log」即時判定。
 *
 * 判定規則（依 tools/audit/tasks.json 的 evidence）：
 *   - files：每個 glob 至少命中一個檔案才算「在」；全在 = 正訊號、全缺 = 負訊號、部分 = 混合
 *   - commitGrep：`git log --oneline --grep <pattern>` 有 commit = 正訊號（選填；早期任務
 *     的 commit 訊息沒帶 T-0xx 記號，這類任務只靠檔案證據）
 *   - 全部正訊號 → ✅、全部負訊號 → ❌、其餘 → ⚠️、無任何證據 → ❓
 *   - override：證據判不了的人工判定（如 RWD 需實機檢視、壓測 gate 未達標），
 *     直接採用其 status 並在盤點依據欄標明「人工判定」與理由
 *
 * 用法：
 *   node tools/audit/generate-audit-snapshot.mjs          # 重寫 AUDIT_REPORT.md 標記區塊
 *                                                         # + 另存 docs/report/audit-snapshot-YYYYMMDD.md
 *   node tools/audit/generate-audit-snapshot.mjs --check  # 只比對不寫入；有 diff 退出碼 1（可掛 CI）
 *
 * 更正進度：改 tools/audit/tasks.json（證據清單/override），再重跑本工具。
 * 標記區塊（<!-- AUDIT:BEGIN --> ~ <!-- AUDIT:END -->）內的手動修改會被覆蓋；
 * 標記外的人工敘述不受影響。
 */
import { readFileSync, writeFileSync, globSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');
const REPORT_PATH = resolve(ROOT, 'AUDIT_REPORT.md');
const TASKS_PATH = resolve(__dirname, 'tasks.json');
const BEGIN_MARK = '<!-- AUDIT:BEGIN';
const END_MARK = '<!-- AUDIT:END -->';

const checkMode = process.argv.includes('--check');

// ─────────────────────────────────────────────────────────────────────────────
// 證據判定
// ─────────────────────────────────────────────────────────────────────────────

function gitLogCount(pattern) {
  const out = execFileSync('git', ['log', '--oneline', '--grep', pattern], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  return out.split('\n').filter(Boolean).length;
}

function checkFiles(patterns) {
  const missing = [];
  for (const p of patterns) {
    if (globSync(p, { cwd: ROOT }).length === 0) missing.push(p);
  }
  return { total: patterns.length, found: patterns.length - missing.length, missing };
}

function evaluate(task) {
  if (task.override) {
    return { status: task.override.status, basis: `人工判定：${task.override.reason}` };
  }
  const ev = task.evidence ?? {};
  const signals = [];
  const parts = [];

  if (Array.isArray(ev.files) && ev.files.length > 0) {
    const f = checkFiles(ev.files);
    signals.push(f.found === f.total ? 1 : f.found === 0 ? -1 : 0);
    parts.push(
      f.missing.length === 0
        ? `檔案 ${f.found}/${f.total}`
        : `檔案 ${f.found}/${f.total}（缺 \`${f.missing.join('`、`')}\`）`
    );
  }
  if (ev.commitGrep) {
    const n = gitLogCount(ev.commitGrep);
    signals.push(n > 0 ? 1 : -1);
    parts.push(`git log --grep "${ev.commitGrep}" → ${n} 筆`);
  }

  let status;
  if (signals.length === 0) status = '❓';
  else if (signals.every((s) => s === 1)) status = '✅';
  else if (signals.every((s) => s === -1)) status = '❌';
  else status = '⚠️';

  let basis = parts.join('；') || '無可自動盤點的證據';
  if (task.note) basis += `；註：${task.note}`;
  return { status, basis };
}

// ─────────────────────────────────────────────────────────────────────────────
// Markdown 產生
// ─────────────────────────────────────────────────────────────────────────────

function renderBlock(config) {
  const lines = [];
  const counts = { '✅': 0, '⚠️': 0, '❌': 0, '❓': 0 };
  let total = 0;

  for (const sec of config.sections) {
    lines.push(`### ${sec.id} ${sec.title}`, '');
    const owner = !!sec.ownerColumn;
    const prio = sec.priorityColumn !== false;
    const header = ['任務', ...(owner ? ['負責人'] : []), ...(prio ? ['優先'] : []), '任務名稱', '狀態', '盤點依據（自動產生）'];
    const align = ['---', ...(owner ? ['---'] : []), ...(prio ? [':--:'] : []), '---', ':--:', '---'];
    lines.push(`| ${header.join(' | ')} |`, `|${align.join('|')}|`);

    for (const task of sec.tasks) {
      const { status, basis } = evaluate(task);
      counts[status] += 1;
      total += 1;
      const cells = [task.id, ...(owner ? [task.owner ?? ''] : []), ...(prio ? [task.priority ?? ''] : []), task.title, status, basis];
      lines.push(`| ${cells.join(' | ')} |`);
    }
    lines.push('');
  }

  lines.push(`### ${config.stats.id} ${config.stats.title}`, '');
  lines.push('| 狀態 | 任務數 | 占比 |', '|---|:--:|:--:|');
  for (const s of ['✅', '⚠️', '❌', '❓']) {
    const label = { '✅': '✅ 已完成', '⚠️': '⚠️ 部分完成', '❌': '❌ 未開始', '❓': '❓ 待確認' }[s];
    lines.push(`| ${label} | ${counts[s]} | ${Math.round((counts[s] / total) * 100)}% |`);
  }
  lines.push(`| **總計** | **${total}** | 100% |`, '');
  return lines.join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// 主流程
// ─────────────────────────────────────────────────────────────────────────────

const config = JSON.parse(readFileSync(TASKS_PATH, 'utf8'));
const block = renderBlock(config);

const report = readFileSync(REPORT_PATH, 'utf8');
const beginIdx = report.indexOf(BEGIN_MARK);
const endIdx = report.indexOf(END_MARK);
if (beginIdx === -1 || endIdx === -1 || endIdx < beginIdx) {
  console.error(`找不到標記區塊：AUDIT_REPORT.md 需含 "${BEGIN_MARK} ... -->" 與 "${END_MARK}"`);
  process.exit(2);
}
const beginLineEnd = report.indexOf('-->', beginIdx) + '-->'.length;
const current = report.slice(beginLineEnd, endIdx);
const normalize = (s) => s.replace(/\r\n/g, '\n').trim();

if (checkMode) {
  if (normalize(current) === normalize(block)) {
    console.log('AUDIT check OK：附錄 A 標記區塊與當下工作樹一致。');
    process.exit(0);
  }
  const a = normalize(current).split('\n');
  const b = normalize(block).split('\n');
  console.error('AUDIT check FAILED：附錄 A 與當下工作樹有落差（- 現況文件 / + 重新盤點結果）：');
  const max = Math.max(a.length, b.length);
  for (let i = 0; i < max; i++) {
    if (a[i] !== b[i]) {
      if (a[i] !== undefined) console.error(`- ${a[i]}`);
      if (b[i] !== undefined) console.error(`+ ${b[i]}`);
    }
  }
  console.error('\n請跑 node tools/audit/generate-audit-snapshot.mjs 重生區塊（或修正 tools/audit/tasks.json）。');
  process.exit(1);
}

// 寫回 AUDIT_REPORT.md 標記區塊
const updated = report.slice(0, beginLineEnd) + '\n\n' + block + '\n' + report.slice(endIdx);
writeFileSync(REPORT_PATH, updated);

// 另存當日快照
const now = new Date();
const ymd = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
const head = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
const snapshotPath = resolve(ROOT, `docs/report/audit-snapshot-${ymd}.md`);
const snapshotHeader = [
  `# 工作分配表進度快照 — ${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`,
  '',
  `> 由 \`node tools/audit/generate-audit-snapshot.mjs\` 產生（git HEAD：\`${head}\`）。`,
  `> 證據清單：\`tools/audit/tasks.json\`；判定規則見該工具檔頭註解。`,
  '',
].join('\n');
writeFileSync(snapshotPath, snapshotHeader + '\n' + block + '\n');

console.log('已更新 AUDIT_REPORT.md 標記區塊');
console.log(`已另存快照：docs/report/audit-snapshot-${ymd}.md`);
