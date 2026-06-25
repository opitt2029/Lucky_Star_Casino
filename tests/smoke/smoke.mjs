#!/usr/bin/env node
/**
 * Lucky Star Casino — 全功能實機 end-to-end smoke test。
 *
 * 經由 gateway(8080) 真打 member / wallet / game / rank 的核心端點，
 * 驗證「路由 + JWT 鏈路 + 業務邏輯」整條鏈是否可用。
 *
 * 前置：docker 基礎設施全 healthy + 5 個後端服務都已啟動（見 tests/smoke/README.md）。
 * 執行：node tests/smoke/smoke.mjs
 * 參數（環境變數）：
 *   GATEWAY_URL  預設 http://localhost:8080
 *
 * 設計：每個檢查都包在 try/catch，永不中途丟出；最後印出 PASS/FAIL 表並以
 * 退出碼反映是否有 FAIL（WARN 不影響退出碼）。冪等鍵一律由伺服器端生成（AGENTS.md §12）。
 */

const GATEWAY = process.env.GATEWAY_URL || 'http://localhost:8080';

// ── 結果收集 ────────────────────────────────────────────────────────────────
const results = [];
function record(name, status, detail = '') {
  // status: 'PASS' | 'FAIL' | 'WARN'
  results.push({ name, status, detail });
  const icon = status === 'PASS' ? '✓' : status === 'WARN' ? '!' : '✗';
  console.log(`  ${icon} [${status}] ${name}${detail ? ' — ' + detail : ''}`);
}

// ── HTTP helper ─────────────────────────────────────────────────────────────
async function http(method, path, { token, body, headers = {} } = {}) {
  const opts = { method, headers: { ...headers } };
  if (token) opts.headers['Authorization'] = `Bearer ${token}`;
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(`${GATEWAY}${path}`, opts);
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: res.status, json, text };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ApiResponse<T> = { success, data, message }；RankController 回裸物件，故 data 兩種都吃。
const dataOf = (j) => (j && typeof j === 'object' && 'data' in j ? j.data : j);

// ── 主流程 ──────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n=== Lucky Star Casino smoke test ===`);
  console.log(`gateway: ${GATEWAY}\n`);

  // ---- 0. gateway 健康檢查 ----
  console.log('[0] gateway 健康檢查');
  try {
    const r = await http('GET', '/actuator/health');
    const up = dataOf(r.json)?.status === 'UP' || r.json?.status === 'UP';
    record('GET /actuator/health', up ? 'PASS' : 'FAIL', `status=${r.status} body=${r.text.slice(0, 80)}`);
  } catch (e) {
    record('GET /actuator/health', 'FAIL', `gateway 無法連線：${e.message}`);
    console.log('\n✗ gateway 不可達，中止後續測試。請確認服務已啟動。\n');
    return summarize();
  }

  // ---- 1. member：註冊 / 登入 / profile / refresh ----
  console.log('\n[1] member-service');
  const stamp = Date.now();
  const username = `smoke_${stamp}`;
  const cred = { username, email: `${username}@smoke.test`, password: 'smoke1234', nickname: 'SmokeBot' };
  let token, refreshToken, playerId;

  try {
    const r = await http('POST', '/api/v1/auth/register', { body: cred });
    const d = dataOf(r.json);
    playerId = d?.id;
    record('POST /api/v1/auth/register', r.status === 201 && playerId ? 'PASS' : 'FAIL',
      `status=${r.status} id=${playerId}`);
  } catch (e) { record('POST /api/v1/auth/register', 'FAIL', e.message); }

  try {
    const r = await http('POST', '/api/v1/auth/login', {
      body: { username: cred.username, password: cred.password },
    });
    const d = dataOf(r.json);
    token = d?.accessToken;
    refreshToken = d?.refreshToken;
    record('POST /api/v1/auth/login', r.status === 200 && token ? 'PASS' : 'FAIL',
      `status=${r.status} token=${token ? 'yes' : 'no'}`);
  } catch (e) { record('POST /api/v1/auth/login', 'FAIL', e.message); }

  if (!token) {
    console.log('\n✗ 無 JWT，後續需登入的端點略過。\n');
    return summarize();
  }

  try {
    const r = await http('GET', '/api/v1/player/profile', { token });
    const d = dataOf(r.json);
    record('GET /api/v1/player/profile', r.status === 200 && d ? 'PASS' : 'FAIL', `status=${r.status}`);
  } catch (e) { record('GET /api/v1/player/profile', 'FAIL', e.message); }

  try {
    const r = await http('PUT', '/api/v1/player/profile', { token, body: { nickname: 'SmokeBot2' } });
    const d = dataOf(r.json);
    record('PUT /api/v1/player/profile', r.status === 200 && d?.nickname === 'SmokeBot2' ? 'PASS' : 'FAIL',
      `status=${r.status} nickname=${d?.nickname}`);
  } catch (e) { record('PUT /api/v1/player/profile', 'FAIL', e.message); }

  try {
    const r = await http('POST', '/api/v1/auth/refresh', { body: { refreshToken } });
    const d = dataOf(r.json);
    if (d?.accessToken) token = d.accessToken; // 用新 token 繼續
    record('POST /api/v1/auth/refresh', r.status === 200 && d?.accessToken ? 'PASS' : 'FAIL', `status=${r.status}`);
  } catch (e) { record('POST /api/v1/auth/refresh', 'FAIL', e.message); }

  // ---- 2. wallet：等錢包建立(Kafka 非同步) → 注資 → 餘額/流水/鑽石 ----
  console.log('\n[2] wallet-service');
  // 錢包由 member.registered 事件非同步建立，輪詢直到 balance 端點不再 404。
  let walletReady = false;
  for (let i = 0; i < 15; i++) {
    const r = await http('GET', '/api/v1/wallet/balance', { token });
    if (r.status === 200) { walletReady = true; break; }
    await sleep(1000);
  }
  record('錢包建立 (Kafka member.registered → createWallet)', walletReady ? 'PASS' : 'FAIL',
    walletReady ? '' : '15s 內錢包未建立');

  // 注資：新錢包餘額 0 < 100 門檻 → bankruptcy-aid 同步發 1000，供遊戲下注。
  try {
    const r = await http('POST', '/api/v1/wallet/bankruptcy-aid', { token });
    record('POST /api/v1/wallet/bankruptcy-aid (注資 1000)', r.status === 200 ? 'PASS' : 'FAIL', `status=${r.status}`);
  } catch (e) { record('POST /api/v1/wallet/bankruptcy-aid', 'FAIL', e.message); }

  let balance = 0;
  try {
    const r = await http('GET', '/api/v1/wallet/balance', { token });
    const d = dataOf(r.json);
    balance = d?.balance ?? d?.totalBalance ?? 0;
    record('GET /api/v1/wallet/balance', r.status === 200 ? 'PASS' : 'FAIL',
      `status=${r.status} balance=${balance}`);
  } catch (e) { record('GET /api/v1/wallet/balance', 'FAIL', e.message); }

  try {
    const r = await http('GET', '/api/v1/wallet/transactions?page=0&size=10', { token });
    record('GET /api/v1/wallet/transactions', r.status === 200 ? 'PASS' : 'FAIL', `status=${r.status}`);
  } catch (e) { record('GET /api/v1/wallet/transactions', 'FAIL', e.message); }

  try {
    const r = await http('POST', '/api/v1/wallet/daily-checkin', { token });
    // 200 = 簽到成功；若當日已簽到後端回 4xx，視為端點存活 WARN
    record('POST /api/v1/wallet/daily-checkin', r.status === 200 ? 'PASS' : 'WARN', `status=${r.status}`);
  } catch (e) { record('POST /api/v1/wallet/daily-checkin', 'FAIL', e.message); }

  try {
    const r = await http('GET', '/api/v1/wallet/diamond/balance', { token });
    record('GET /api/v1/wallet/diamond/balance', r.status === 200 ? 'PASS' : 'FAIL', `status=${r.status}`);
  } catch (e) { record('GET /api/v1/wallet/diamond/balance', 'FAIL', e.message); }

  // ---- 3. game：slot / baccarat / fishing / rtp / verify ----
  console.log('\n[3] game-service');
  let slotRoundId;

  // 3a. 老虎機單次模式
  try {
    const r = await http('POST', '/api/v1/game/slot/spin', { token, body: { bet: 100 } });
    const d = dataOf(r.json);
    slotRoundId = d?.roundId;
    record('POST /api/v1/game/slot/spin', r.status === 200 && slotRoundId ? 'PASS' : 'FAIL',
      `status=${r.status} payout=${d?.payout}`);
  } catch (e) { record('POST /api/v1/game/slot/spin', 'FAIL', e.message); }

  // 3b. 老虎機 commit-ahead 兩階段
  try {
    const r1 = await http('POST', '/api/v1/game/slot/round', { token, body: { bet: 100 } });
    const d1 = dataOf(r1.json);
    const rid = d1?.roundId;
    record('POST /api/v1/game/slot/round (承諾)', r1.status === 200 && d1?.serverSeedHash ? 'PASS' : 'FAIL',
      `status=${r1.status} roundId=${rid ? 'yes' : 'no'}`);
    if (rid) {
      const r2 = await http('POST', `/api/v1/game/slot/round/${rid}/settle`, { token });
      const d2 = dataOf(r2.json);
      record('POST /api/v1/game/slot/round/{id}/settle (揭露)', r2.status === 200 && d2?.serverSeed ? 'PASS' : 'FAIL',
        `status=${r2.status}`);
    }
  } catch (e) { record('slot commit-ahead', 'FAIL', e.message); }

  // 3c. 百家樂兩階段
  try {
    const r1 = await http('POST', '/api/v1/game/baccarat/bet', { token, body: { player: 100, banker: 0, tie: 0 } });
    const d1 = dataOf(r1.json);
    const rid = d1?.roundId;
    record('POST /api/v1/game/baccarat/bet', r1.status === 200 && rid ? 'PASS' : 'FAIL',
      `status=${r1.status} totalBet=${d1?.totalBet}`);
    if (rid) {
      const r2 = await http('POST', `/api/v1/game/baccarat/${rid}/result`, { token });
      record('POST /api/v1/game/baccarat/{id}/result', r2.status === 200 ? 'PASS' : 'FAIL', `status=${r2.status}`);
    }
  } catch (e) { record('baccarat', 'FAIL', e.message); }

  // 3d. 捕魚機完整流程
  try {
    const rs = await http('POST', '/api/v1/game/fishing/session/start', {
      token, body: { buyIn: 200, cannonLevel: 1, betPerShot: 10 },
    });
    const sv = dataOf(rs.json);
    const sessionId = sv?.sessionId;
    record('POST /api/v1/game/fishing/session/start', rs.status === 200 && sessionId ? 'PASS' : 'FAIL',
      `status=${rs.status} buyIn=${sv?.buyIn}`);

    if (sessionId) {
      const ra = await http('GET', '/api/v1/game/fishing/session/active', { token });
      record('GET /api/v1/game/fishing/session/active', ra.status === 200 ? 'PASS' : 'FAIL', `status=${ra.status}`);

      // 同一條大魚（龍王 HP=2000）跨兩批各 2 發，驗證「跨批累傷不回滿」（血量模型核心、ADR-003）。
      // fishInstanceId 為 @NotBlank 必填（缺了會 400）；betPerShot=10 須等於進場選定面額（ADR-004，與砲台解耦）。
      const fishType = 'DRAGON_KING';
      const fishInstanceId = `smoke-fish-${stamp}`;
      const fireBatch = (seqs) => http('POST', `/api/v1/game/fishing/${sessionId}/shots`,
        { token, body: { shots: seqs.map((seq) => ({ shotSeq: seq, betPerShot: 10, fishType, fishInstanceId })) } });
      const lastAlive = (j) => [...(dataOf(j)?.results || [])].reverse().find((x) => x.accepted && !x.killed);

      const b1 = await fireBatch([1, 2]);
      record('POST /api/v1/game/fishing/{id}/shots', b1.status === 200 && dataOf(b1.json)?.results?.length ? 'PASS' : 'FAIL',
        `status=${b1.status} results=${dataOf(b1.json)?.results?.length}`);

      // 第二批同一條魚再 2 發：hpRemaining 必須延續第一批繼續下降（修復前累傷未持久化會「回寫」回滿）。
      const b2 = await fireBatch([3, 4]);
      const a1 = lastAlive(b1.json);
      const a2 = lastAlive(b2.json);
      const crossOk = b2.status === 200 && a1 && a2 && a2.hpRemaining < a1.hpRemaining;
      record('捕魚跨批累傷持久化（hpRemaining 不回滿）', crossOk ? 'PASS' : 'FAIL',
        a1 && a2 ? `batch1 hp=${a1.hpRemaining} → batch2 hp=${a2.hpRemaining}` : `status=${b2.status}`);

      const re = await http('POST', `/api/v1/game/fishing/${sessionId}/end`, { token });
      const de = dataOf(re.json);
      record('POST /api/v1/game/fishing/{id}/end', re.status === 200 && de?.serverSeed ? 'PASS' : 'FAIL',
        `status=${re.status} credited=${de?.credited}`);

      // 結算後逐發公平性驗證（用第一發）
      const rv = await http('GET',
        `/api/v1/game/fishing/${sessionId}/verify-shot?shotSeq=1&fishType=${encodeURIComponent(fishType)}&betPerShot=10`,
        { token });
      record('GET /api/v1/game/fishing/{id}/verify-shot', rv.status === 200 ? 'PASS' : 'FAIL', `status=${rv.status}`);
    }
  } catch (e) { record('fishing', 'FAIL', e.message); }

  // 3e. RTP 統計
  try {
    const r = await http('GET', '/api/v1/game/rtp', { token });
    record('GET /api/v1/game/rtp', r.status === 200 ? 'PASS' : 'FAIL', `status=${r.status}`);
  } catch (e) { record('GET /api/v1/game/rtp', 'FAIL', e.message); }

  // 3f. RNG 公平性驗證（用稍早 slot spin 的 roundId）
  if (slotRoundId) {
    try {
      const r = await http('GET', `/api/v1/game/verify/${slotRoundId}`, { token });
      const d = dataOf(r.json);
      record('GET /api/v1/game/verify/{roundId}', r.status === 200 ? 'PASS' : 'FAIL',
        `status=${r.status} valid=${d?.valid ?? d?.verified}`);
    } catch (e) { record('GET /api/v1/game/verify/{roundId}', 'FAIL', e.message); }
  }

  // ---- 4. rank：全服 / 單人 / 好友 ----
  console.log('\n[4] rank-service');
  try {
    const r = await http('GET', '/api/v1/rank/global', { token });
    record('GET /api/v1/rank/global', r.status === 200 ? 'PASS' : 'FAIL',
      `status=${r.status} entries=${Array.isArray(r.json) ? r.json.length : '?'}`);
  } catch (e) { record('GET /api/v1/rank/global', 'FAIL', e.message); }

  try {
    const r = await http('GET', `/api/v1/rank/global/${playerId}`, { token });
    // 200=有排名；404=尚未進榜（快照排程未跑），兩者皆代表端點存活
    record('GET /api/v1/rank/global/{playerId}', r.status === 200 ? 'PASS' : r.status === 404 ? 'WARN' : 'FAIL',
      `status=${r.status}`);
  } catch (e) { record('GET /api/v1/rank/global/{playerId}', 'FAIL', e.message); }

  try {
    const r = await http('GET', '/api/v1/rank/friends', { token });
    record('GET /api/v1/rank/friends', r.status === 200 ? 'PASS' : 'FAIL',
      `status=${r.status} entries=${Array.isArray(r.json) ? r.json.length : '?'}`);
  } catch (e) { record('GET /api/v1/rank/friends', 'FAIL', e.message); }

  // ---- 5. auth 登出 ----
  console.log('\n[5] cleanup');
  try {
    const r = await http('POST', '/api/v1/auth/logout', { token });
    record('POST /api/v1/auth/logout', r.status === 200 ? 'PASS' : 'WARN', `status=${r.status}`);
  } catch (e) { record('POST /api/v1/auth/logout', 'WARN', e.message); }

  return summarize();
}

function summarize() {
  const pass = results.filter((r) => r.status === 'PASS').length;
  const warn = results.filter((r) => r.status === 'WARN').length;
  const fail = results.filter((r) => r.status === 'FAIL').length;
  console.log(`\n=== 結果：${pass} PASS / ${warn} WARN / ${fail} FAIL（共 ${results.length}）===`);
  if (fail > 0) {
    console.log('\n失敗項目：');
    results.filter((r) => r.status === 'FAIL').forEach((r) => console.log(`  ✗ ${r.name} — ${r.detail}`));
  }
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('smoke 執行發生未預期錯誤：', e);
  process.exit(2);
});
