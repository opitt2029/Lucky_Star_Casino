#!/usr/bin/env node
/**
 * Lucky Star Casino — T-093 跨服務全鏈路 end-to-end 整合測試。
 *
 * 驗證「下注 → 帳務 → 排行 → 通知」整條事件鏈（皆經 gateway 8080）：
 *
 *   member(註冊/登入) → Kafka member.registered → wallet(建錢包)
 *   game(slot spin) → wallet(debit BET / credit WIN) → Kafka wallet.credit
 *     ├→ wallet 讀視圖(MySQL CQRS，transactions 查得到流水)
 *     ├→ rank(計分，global 榜查得到玩家)
 *     └→ game.result → notification → WebSocket/STOMP 推播 /user/queue/notifications
 *
 * 與 tests/smoke/smoke.mjs 的差異：smoke 驗「各端點活著」，本測驗「跨服務事件鏈的
 * 資料一致性」——同一局的 roundId 必須在帳務流水、遊戲結果、WS 推播三處對得上。
 *
 * 前置：docker compose 全 healthy（15 容器）。
 * 執行：node tests/e2e/full-chain.mjs
 * 參數（環境變數）：
 *   GATEWAY_URL  預設 http://localhost:8080
 *   WS_URL       預設 ws://localhost:8080/ws（gateway notification-ws 路由）
 *
 * 設計：零外部依賴——STOMP 是純文字協定，這裡直接以 Node 內建 WebSocket（Node >= 22）
 * 手組 CONNECT/SUBSCRIBE 帧；JWT 放在 STOMP CONNECT 帧的 Authorization header
 * （gateway /ws 在 JWT whitelist，鑑權由 notification 的 StompAuthChannelInterceptor 做）。
 */

const GATEWAY = process.env.GATEWAY_URL || 'http://localhost:8080';
const WS_URL = process.env.WS_URL || 'ws://localhost:8080/ws';

const MAX_SPINS = 30;          // 理論命中率 ~30.7%，30 局全輸機率 < 0.002%
const BET = 100;
const POLL_TIMEOUT_MS = 20000; // Kafka 非同步鏈路（讀視圖/排行/推播）的等待上限
const POLL_INTERVAL_MS = 1000;

// ── 結果收集（沿用 smoke.mjs 的 PASS/WARN/FAIL 模式） ─────────────────────────
const results = [];
function record(name, status, detail = '') {
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
const dataOf = (j) => (j && typeof j === 'object' && 'data' in j ? j.data : j);

/** 輪詢直到 fn 回傳 truthy 或逾時；回傳最後一次的值。 */
async function pollUntil(fn, timeoutMs = POLL_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await fn();
    if (last) return last;
    await sleep(POLL_INTERVAL_MS);
  }
  return last;
}

// ── 極簡 STOMP client（Node 內建 WebSocket + 文字帧手工組裝/解析） ────────────
class MiniStomp {
  constructor(url, token) {
    this.url = url;
    this.token = token;
    this.buffer = '';
    this.messages = []; // { destination, body(JSON parsed 或原文) }
    this.connected = false;
    this.error = null;
  }

  frame(command, headers, body = '') {
    const head = Object.entries(headers).map(([k, v]) => `${k}:${v}`).join('\n');
    return `${command}\n${head}\n\n${body}\u0000`;
  }

  /** 連線 + STOMP CONNECT 交握；逾時或 ERROR 帧都 reject。 */
  connect(timeoutMs = 10000) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.url);
      this.ws = ws;
      const timer = setTimeout(() => reject(new Error(`STOMP CONNECT 逾時 ${timeoutMs}ms`)), timeoutMs);

      ws.onopen = () => {
        ws.send(this.frame('CONNECT', {
          'accept-version': '1.2',
          host: new URL(this.url).host,
          'heart-beat': '0,0', // 關閉心跳，測試腳本存活期短
          Authorization: `Bearer ${this.token}`,
        }));
      };
      ws.onmessage = (event) => {
        const data = typeof event.data === 'string' ? event.data : '';
        this.buffer += data;
        // 一個 WS message 可能含多個 STOMP 帧（\0 結尾）；殘帧留在 buffer
        let idx;
        while ((idx = this.buffer.indexOf('\u0000')) >= 0) {
          const raw = this.buffer.slice(0, idx).replace(/^\n+/, ''); // 帧間可能夾換行
          this.buffer = this.buffer.slice(idx + 1);
          if (!raw) continue;
          const sep = raw.indexOf('\n\n');
          const headLines = (sep >= 0 ? raw.slice(0, sep) : raw).split('\n');
          const command = headLines[0];
          const headers = Object.fromEntries(
            headLines.slice(1).map((l) => [l.slice(0, l.indexOf(':')), l.slice(l.indexOf(':') + 1)]));
          const body = sep >= 0 ? raw.slice(sep + 2) : '';

          if (command === 'CONNECTED') {
            this.connected = true;
            clearTimeout(timer);
            resolve(headers);
          } else if (command === 'MESSAGE') {
            let parsed = body;
            try { parsed = JSON.parse(body); } catch { /* 保留原文 */ }
            this.messages.push({ destination: headers.destination, body: parsed });
          } else if (command === 'ERROR') {
            this.error = headers.message || body;
            clearTimeout(timer);
            reject(new Error(`STOMP ERROR: ${this.error}`));
          }
        }
      };
      ws.onerror = () => { /* onclose 會跟著觸發，錯誤細節在 close code */ };
      ws.onclose = (event) => {
        if (!this.connected) {
          clearTimeout(timer);
          reject(new Error(`WS 交握前關閉 code=${event.code}`));
        }
      };
    });
  }

  subscribe(destination, id) {
    this.ws.send(this.frame('SUBSCRIBE', { id, destination }));
  }

  /** 等待符合條件的推播訊息（含已收到的存量）。 */
  async waitForMessage(predicate, timeoutMs = POLL_TIMEOUT_MS) {
    return pollUntil(() => this.messages.find(predicate), timeoutMs);
  }

  close() {
    try { this.ws?.close(); } catch { /* 收尾盡力而為 */ }
  }
}

// ── 主流程 ──────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n=== Lucky Star Casino 全鏈路 e2e（T-093）===');
  console.log(`gateway: ${GATEWAY}\nws:      ${WS_URL}\n`);

  // [0] gateway 健康檢查（不通就沒必要繼續）
  console.log('[0] 前置：gateway 健康檢查');
  try {
    const r = await http('GET', '/actuator/health');
    const up = dataOf(r.json)?.status === 'UP' || r.json?.status === 'UP';
    record('GET /actuator/health', up ? 'PASS' : 'FAIL', `status=${r.status}`);
    if (!up) return summarize();
  } catch (e) {
    record('GET /actuator/health', 'FAIL', `gateway 無法連線：${e.message}`);
    return summarize();
  }

  // [1] member：註冊 + 登入
  console.log('\n[1] 下注前置：member 註冊/登入 → wallet 建立（Kafka member.registered）');
  const stamp = Date.now();
  const cred = {
    username: `e2e_${stamp}`, email: `e2e_${stamp}@chain.test`,
    password: 'e2e12345', nickname: 'ChainBot',
  };
  let token, playerId;
  {
    const r = await http('POST', '/api/v1/auth/register', { body: cred });
    playerId = dataOf(r.json)?.id;
    record('註冊玩家', r.status === 201 && playerId ? 'PASS' : 'FAIL', `status=${r.status} playerId=${playerId}`);
    if (!playerId) return summarize();

    const rl = await http('POST', '/api/v1/auth/login', { body: { username: cred.username, password: cred.password } });
    token = dataOf(rl.json)?.accessToken;
    record('登入取得 JWT', rl.status === 200 && token ? 'PASS' : 'FAIL', `status=${rl.status}`);
    if (!token) return summarize();
  }

  // 錢包由 member.registered 事件非同步建立 → 輪詢；再注資供下注
  {
    const ready = await pollUntil(async () => (await http('GET', '/api/v1/wallet/balance', { token })).status === 200);
    record('錢包建立（member.registered → wallet createWallet）', ready ? 'PASS' : 'FAIL',
      ready ? '' : `${POLL_TIMEOUT_MS}ms 內未建立`);
    if (!ready) return summarize();

    const ra = await http('POST', '/api/v1/wallet/bankruptcy-aid', { token });
    record('注資（bankruptcy-aid 1000）', ra.status === 200 ? 'PASS' : 'FAIL', `status=${ra.status}`);
  }

  const balanceBefore = dataOf((await http('GET', '/api/v1/wallet/balance', { token })).json)?.balance ?? 0;

  // [2] 通知通道先就位：WS/STOMP 連上並訂閱，才不會漏接稍後 spin 的推播
  console.log('\n[2] 通知通道：WS/STOMP 經 gateway /ws 連 notification-service');
  const stomp = new MiniStomp(WS_URL, token);
  try {
    await stomp.connect();
    record('STOMP CONNECT（JWT 鑑權，StompAuthChannelInterceptor）', 'PASS');
    stomp.subscribe('/user/queue/notifications', 'sub-0'); // 私人佇列：遊戲結果
    stomp.subscribe('/topic/rank', 'sub-1');               // 公共頻道：TOP10 變動廣播
    record('訂閱 /user/queue/notifications + /topic/rank', 'PASS');
  } catch (e) {
    record('STOMP CONNECT', 'FAIL', e.message);
    // 通知環節斷了仍繼續驗帳務/排行，讓報告完整呈現鏈路斷點
  }

  // 反向驗證：無效 JWT 必須被拒（鑑權不是擺飾）
  try {
    const bad = new MiniStomp(WS_URL, 'invalid.jwt.token');
    await bad.connect(5000);
    record('無效 JWT 的 STOMP CONNECT 被拒', 'FAIL', '竟然連上了');
    bad.close();
  } catch {
    record('無效 JWT 的 STOMP CONNECT 被拒', 'PASS');
  }

  // [3] 下注：slot spin 直到中獎（每局都發 game.result；中獎局才有 wallet.credit WIN）
  console.log('\n[3] 下注：slot spin（bet=100）直到中獎');
  let spins = 0, totalPayout = 0, winRound = null;
  const rounds = [];
  for (let i = 0; i < MAX_SPINS && !winRound; i++) {
    const r = await http('POST', '/api/v1/game/slot/spin', { token, body: { bet: BET } });
    if (r.status !== 200) {
      record('POST /api/v1/game/slot/spin', 'FAIL', `第 ${i + 1} 局 status=${r.status} body=${r.text.slice(0, 120)}`);
      return summarize();
    }
    const d = dataOf(r.json);
    spins++;
    totalPayout += d.payout ?? 0;
    rounds.push(d.roundId);
    if ((d.payout ?? 0) > 0) winRound = d;
  }
  record('slot spin 直到中獎', winRound ? 'PASS' : 'FAIL',
    winRound
      ? `${spins} 局中獎，roundId=${winRound.roundId} payout=${winRound.payout}`
      : `${MAX_SPINS} 局皆未中（機率 <0.002%，請檢查 RNG/風控）`);
  if (!winRound) return summarize();

  // [4] 帳務：餘額精確對帳 + CQRS 讀視圖流水（BET debit / WIN credit 與 roundId 對上）
  console.log('\n[4] 帳務：wallet 餘額對帳 + 流水（MySQL 讀視圖，Kafka read-sync）');
  {
    const expected = balanceBefore - spins * BET + totalPayout;
    const actual = dataOf((await http('GET', '/api/v1/wallet/balance', { token })).json)?.balance;
    record('餘額精確對帳（前值 − Σbet ＋ Σpayout）', actual === expected ? 'PASS' : 'FAIL',
      `expected=${expected} actual=${actual}（${balanceBefore} − ${spins}×${BET} ＋ ${totalPayout}）`);
  }
  {
    // 讀視圖由 WalletReadSyncListener 消費 wallet.debit/credit 事件非同步同步 → 輪詢
    const found = await pollUntil(async () => {
      const r = await http('GET', `/api/v1/wallet/transactions?page=0&size=${MAX_SPINS * 2 + 10}`, { token });
      const list = dataOf(r.json)?.content ?? dataOf(r.json) ?? [];
      const bets = list.filter((t) => t.type === 'DEBIT' && t.subType === 'BET');
      const win = list.find((t) => t.type === 'CREDIT' && t.subType === 'WIN' && t.referenceId === winRound.roundId);
      return bets.length >= spins && win ? { bets: bets.length, win } : null;
    });
    record('流水含全部 BET debit ＋ 中獎局 WIN credit（roundId 對上）', found ? 'PASS' : 'FAIL',
      found ? `BET×${found.bets}，WIN amount=${found.win.amount} ref=${found.win.referenceId}` : '逾時未同步到讀視圖');
  }

  // [5] 排行：rank 消費 wallet.credit/debit 後，玩家應出現在全服持幣榜
  console.log('\n[5] 排行：rank-service 消費 wallet 事件 → global 榜');
  {
    const entry = await pollUntil(async () => {
      const r = await http('GET', `/api/v1/rank/global/${playerId}`, { token });
      return r.status === 200 ? (dataOf(r.json) ?? r.json) : null;
    });
    record('GET /api/v1/rank/global/{playerId} 進榜', entry ? 'PASS' : 'FAIL',
      entry ? `rank=${entry.rank ?? '?'} score=${entry.score ?? entry.coins ?? '?'}` : '逾時未進榜');
  }
  {
    // 今日贏幣榜只認 WIN 子型（AGENTS.md 雷區 18）——中獎局的 WIN 必須計入
    const me = await pollUntil(async () => {
      const r = await http('GET', '/api/v1/rank/daily/winnings/me', { token });
      return r.status === 200 ? (dataOf(r.json) ?? r.json) : null;
    });
    record('GET /api/v1/rank/daily/winnings/me（WIN 計分）', me ? 'PASS' : 'WARN',
      me ? `score=${me.score ?? me.amount ?? JSON.stringify(me).slice(0, 60)}` : '逾時未計分（若排程延遲屬可容忍）');
  }

  // [6] 通知：中獎局的 GAME_RESULT 必須推到玩家私人佇列，且 roundId/bet/payout 對上
  console.log('\n[6] 通知：game.result → notification → WS 推播');
  if (stomp.connected) {
    const msg = await stomp.waitForMessage(
      (m) => m.destination === '/user/queue/notifications'
        && m.body?.type === 'GAME_RESULT' && m.body?.roundId === winRound.roundId);
    record('收到中獎局 GAME_RESULT 推播（roundId 對上）', msg ? 'PASS' : 'FAIL',
      msg ? `bet=${msg.body.bet} payout=${msg.body.payout} win=${msg.body.win}` : '逾時未收到');
    if (msg) {
      const fieldsOk = msg.body.gameType === 'SLOT' && msg.body.bet === BET
        && msg.body.payout === winRound.payout && msg.body.win === true;
      record('推播欄位與遊戲回應一致（gameType/bet/payout/win）', fieldsOk ? 'PASS' : 'FAIL',
        JSON.stringify({ gameType: msg.body.gameType, bet: msg.body.bet, payout: msg.body.payout, win: msg.body.win }));
    }
    const allSpins = stomp.messages.filter(
      (m) => m.destination === '/user/queue/notifications' && m.body?.type === 'GAME_RESULT').length;
    record('每局 spin 皆有推播', allSpins >= spins ? 'PASS' : 'WARN', `收到 ${allSpins}/${spins}（best-effort 允許少量遺漏）`);
    const rankBroadcast = stomp.messages.filter((m) => m.destination === '/topic/rank').length;
    // TOP10 名單有變才廣播（節流 + 順序敏感），新玩家通常擠不進 TOP10 → 收不到屬正常
    record('/topic/rank 廣播（僅 TOP10 變動時發）', 'PASS', `收到 ${rankBroadcast} 則（0 則屬正常）`);
  } else {
    record('收到中獎局 GAME_RESULT 推播', 'FAIL', 'WS 未連線');
  }

  // [7] 收尾
  console.log('\n[7] 收尾');
  stomp.close();
  const rl = await http('POST', '/api/v1/auth/logout', { token });
  record('登出', rl.status === 200 ? 'PASS' : 'WARN', `status=${rl.status}`);

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
  console.error('全鏈路 e2e 發生未預期錯誤：', e);
  process.exit(2);
});
