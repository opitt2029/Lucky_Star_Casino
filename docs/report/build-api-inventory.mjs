// 幸運星幣城 — API 盤點與分類 簡報產生器
// 風格參照 docs/report/幸運星幣城(看這個).pptx（深藍底 + 金色點綴，PptxGenJS）
// 執行：node docs/report/build-api-inventory.mjs
import PptxGenJS from "pptxgenjs";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---- 設計 token（萃取自參照檔）----
const NAVY = "141833";      // 封面底
const NAVY2 = "1B1F3B";     // 內頁底
const CARD = "F4F5F9";      // 淺色卡片
const INK = "1B1F3B";       // 卡片深色標題
const SLATE = "4A4E68";     // 卡片內文
const MUTED = "8A8FB0";     // 次要/頁尾
const GOLD = "C9A227";      // 主金
const GOLDLT = "E4C766";    // 亮金
const WHITE = "FFFFFF";
const BLUE = "CADCFC";      // 封面副標
const HEAD = "Cambria";
const BODY = "Calibri";

const pptx = new PptxGenJS();
pptx.defineLayout({ name: "W16x9", width: 13.333, height: 7.5 });
pptx.layout = "W16x9";
pptx.author = "Lucky Star Casino";
pptx.company = "PptxGenJS";

// ---- 共用：內頁頁首 + 頁尾 ----
function chrome(slide, kicker, title, pageNo) {
  slide.background = { color: NAVY2 };
  slide.addText(kicker, {
    x: 0.6, y: 0.45, w: 8, h: 0.35, fontFace: BODY, fontSize: 12, bold: true,
    color: GOLD, charSpacing: 2, valign: "middle",
  });
  slide.addText(title, {
    x: 0.6, y: 0.8, w: 11.8, h: 0.7, fontFace: BODY, fontSize: 30, bold: true,
    color: WHITE, valign: "middle",
  });
  slide.addShape(pptx.ShapeType.rect, { x: 0.62, y: 1.55, w: 1.2, h: 0.05, fill: { color: GOLD } });
  slide.addText("幸運星幣城｜API 盤點與分類", {
    x: 0.6, y: 7.02, w: 8, h: 0.3, fontFace: BODY, fontSize: 10, color: MUTED, valign: "middle",
  });
  if (pageNo != null) {
    slide.addText(String(pageNo), {
      x: 12.0, y: 7.02, w: 0.9, h: 0.3, fontFace: BODY, fontSize: 10, color: MUTED,
      align: "right", valign: "middle",
    });
  }
}

// ============ 1. 封面 ============
{
  const s = pptx.addSlide();
  s.background = { color: NAVY };
  s.addShape(pptx.ShapeType.ellipse, { x: 10.6, y: -1.6, w: 5.2, h: 5.2, fill: { color: "3A4076", transparency: 55 } });
  s.addShape(pptx.ShapeType.ellipse, { x: 11.9, y: 4.6, w: 3.0, h: 3.0, fill: { color: GOLD, transparency: 85 } });
  s.addShape(pptx.ShapeType.ellipse, { x: 0.9, y: 0.75, w: 0.78, h: 0.78, fill: { color: GOLD } });
  s.addText("幸運星幣城", {
    x: 0.9, y: 1.62, w: 8, h: 0.75, fontFace: BODY, fontSize: 26, bold: true, color: GOLDLT, charSpacing: 4, valign: "middle",
  });
  s.addText("API 盤點與分類", {
    x: 0.9, y: 2.4, w: 11.6, h: 1.15, fontFace: HEAD, fontSize: 54, bold: true, color: WHITE, charSpacing: 1, valign: "middle",
  });
  s.addText("後端 REST API 全面盤點・依存取層級／服務／業務功能三種切法", {
    x: 0.92, y: 3.62, w: 11, h: 0.65, fontFace: BODY, fontSize: 20, color: BLUE, valign: "middle",
  });
  // 三顆金點 + 重點
  const bullets = [
    ["25", "個 Controller"],
    ["72", "個 REST 端點"],
    ["7", "個微服務"],
  ];
  bullets.forEach(([n, t], i) => {
    const x = 0.92 + i * 3.9;
    s.addShape(pptx.ShapeType.ellipse, { x, y: 4.9, w: 0.16, h: 0.16, fill: { color: GOLD } });
    s.addText([
      { text: n + "  ", options: { bold: true, color: GOLDLT, fontSize: 22 } },
      { text: t, options: { color: WHITE, fontSize: 18 } },
    ], { x: x + 0.28, y: 4.68, w: 3.4, h: 0.6, fontFace: BODY, valign: "middle" });
  });
  s.addText("資料來源：backend/*/controller 之 @RequestMapping 靜態盤點（2026-07-24）", {
    x: 0.92, y: 6.75, w: 11, h: 0.4, fontFace: BODY, fontSize: 12, color: MUTED, valign: "middle",
  });
}

// ============ 2. 一頁總覽（stat tiles）============
{
  const s = pptx.addSlide();
  chrome(s, "OVERVIEW・一頁總覽", "72 個 REST 端點，橫跨 7 個微服務", 2);
  const stats = [
    ["72", "REST 端點", "method 級 @Mapping"],
    ["25", "Controller", "分佈於 5 個服務"],
    ["7", "微服務", "gateway 為反向代理"],
    ["3", "分類切法", "層級／服務／功能"],
  ];
  const tileW = 2.85, gap = 0.33, x0 = 0.6, y = 2.15, h = 2.0;
  stats.forEach(([n, label, sub], i) => {
    const x = x0 + i * (tileW + gap);
    s.addShape(pptx.ShapeType.roundRect, { x, y, w: tileW, h, rectRadius: 0.08, fill: { color: CARD } });
    s.addShape(pptx.ShapeType.rect, { x, y, w: tileW, h: 0.09, fill: { color: GOLD } });
    s.addText(n, { x, y: y + 0.25, w: tileW, h: 0.85, fontFace: HEAD, fontSize: 46, bold: true, color: INK, align: "center", valign: "middle" });
    s.addText(label, { x, y: y + 1.12, w: tileW, h: 0.4, fontFace: BODY, fontSize: 16, bold: true, color: INK, align: "center", valign: "middle" });
    s.addText(sub, { x, y: y + 1.52, w: tileW, h: 0.38, fontFace: BODY, fontSize: 11.5, color: SLATE, align: "center", valign: "middle" });
  });
  // 下方一句話說明三種切法
  s.addText("同一份端點，用三種視角盤點：", {
    x: 0.6, y: 4.55, w: 12, h: 0.4, fontFace: BODY, fontSize: 15, bold: true, color: BLUE, valign: "middle",
  });
  const ways = [
    ["依存取層級", "誰能呼叫 → 玩家端 / 後台 / 內部"],
    ["依服務", "落在哪個微服務 → member / wallet / game …"],
    ["依業務功能", "解決什麼問題 → 帳務 / 遊戲 / 社交 …"],
  ];
  ways.forEach(([t, d], i) => {
    const x = 0.6 + i * 4.05;
    s.addShape(pptx.ShapeType.ellipse, { x, y: 5.15, w: 0.16, h: 0.16, fill: { color: GOLD } });
    s.addText([
      { text: t + "\n", options: { bold: true, color: WHITE, fontSize: 15 } },
      { text: d, options: { color: MUTED, fontSize: 12 } },
    ], { x: x + 0.28, y: 5.05, w: 3.7, h: 1.0, fontFace: BODY, valign: "top", lineSpacingMultiple: 1.1 });
  });
}

// ============ 3. 依存取層級 ============
{
  const s = pptx.addSlide();
  chrome(s, "切法一・依存取層級", "誰能呼叫？三層權限、三套邊界", 3);
  const tiers = [
    ["53", "玩家端 API", "/api/v1/**", "玩家 JWT 經 gateway；前端 frontend/ 使用", "認證・錢包・遊戲・社交・排行・簽到・商城"],
    ["14", "後台 API", "/admin/**", "獨立 ADMIN JWT；管理後台 frontend-admin/ 使用", "玩家管理・報表・告警・GM 發幣・目錄／發卡"],
    ["5", "內部 API", "/internal/**", "服務間呼叫，不對外；gateway 剝除後轉發", "member↔wallet 狀態同步・扣款入帳・死信重送"],
  ];
  const cardW = 3.9, gap = 0.32, x0 = 0.6, y = 2.05, h = 4.5;
  tiers.forEach(([n, title, path_, who, scope], i) => {
    const x = x0 + i * (cardW + gap);
    s.addShape(pptx.ShapeType.roundRect, { x, y, w: cardW, h, rectRadius: 0.08, fill: { color: CARD } });
    s.addShape(pptx.ShapeType.rect, { x, y, w: cardW, h: 0.11, fill: { color: GOLD } });
    s.addText([
      { text: n + "  ", options: { fontFace: HEAD, fontSize: 40, bold: true, color: GOLD } },
      { text: "個端點", options: { fontSize: 13, color: SLATE } },
    ], { x: x + 0.3, y: y + 0.32, w: cardW - 0.6, h: 0.8, valign: "middle" });
    s.addText(title, { x: x + 0.3, y: y + 1.15, w: cardW - 0.6, h: 0.4, fontFace: BODY, fontSize: 19, bold: true, color: INK, valign: "middle" });
    s.addText(path_, { x: x + 0.3, y: y + 1.58, w: cardW - 0.6, h: 0.36, fontFace: "Consolas", fontSize: 14, bold: true, color: "8A6D14", valign: "middle" });
    s.addShape(pptx.ShapeType.line, { x: x + 0.3, y: y + 2.02, w: cardW - 0.6, h: 0, line: { color: "D8DBE6", width: 1 } });
    s.addText(who, { x: x + 0.3, y: y + 2.12, w: cardW - 0.6, h: 0.85, fontFace: BODY, fontSize: 13, color: SLATE, valign: "top", lineSpacingMultiple: 1.15 });
    s.addText([
      { text: "涵蓋　", options: { bold: true, color: INK, fontSize: 12.5 } },
      { text: scope, options: { color: SLATE, fontSize: 12.5 } },
    ], { x: x + 0.3, y: y + 3.05, w: cardW - 0.6, h: 1.2, fontFace: BODY, valign: "top", lineSpacingMultiple: 1.2 });
  });
  s.addText("後台與玩家為兩套 JWT secret，gateway 只驗玩家 token → /admin/ 須列入白名單純轉發（雷區 21）", {
    x: 0.6, y: 6.62, w: 12.1, h: 0.35, fontFace: BODY, fontSize: 11.5, italic: true, color: MUTED, valign: "middle",
  });
}

// ============ 4. 依服務分類（表格）============
{
  const s = pptx.addSlide();
  chrome(s, "切法二・依服務", "端點落在哪個微服務", 4);
  const header = [
    { text: "服務", options: { bold: true, color: WHITE, fill: { color: GOLD }, align: "left" } },
    { text: "端點", options: { bold: true, color: WHITE, fill: { color: GOLD }, align: "center" } },
    { text: "路徑前綴", options: { bold: true, color: WHITE, fill: { color: GOLD }, align: "left" } },
    { text: "主要職責", options: { bold: true, color: WHITE, fill: { color: GOLD }, align: "left" } },
  ];
  const rows = [
    ["member-service", "20", "/api/v1/auth・player・friends", "認證、個資、社群綁定、好友、簽到"],
    ["wallet-service", "18", "/api/v1/wallet（含 diamond・shop・topup）", "餘額、交易、贈禮、鑽石、商城、儲值、內部帳務"],
    ["game-service", "14", "/api/v1/game", "老虎機、百家樂、捕魚、公平性驗證、RTP、歷史"],
    ["admin-service", "14", "/admin", "後台登入、玩家管理、報表、告警、GM、目錄"],
    ["rank-service", "6", "/api/v1/rank", "全球排行、好友排行、每日贏分（皆為查詢）"],
  ];
  const body = rows.map((r, i) => r.map((c, j) => ({
    text: c,
    options: {
      fill: { color: i % 2 ? "EEF0F6" : "FFFFFF" },
      color: j === 1 ? GOLD : (j === 0 ? INK : SLATE),
      bold: j <= 1,
      align: j === 1 ? "center" : "left",
      fontFace: j === 2 ? "Consolas" : BODY,
      fontSize: j === 2 ? 11 : 12.5,
    },
  })));
  s.addTable([header, ...body], {
    x: 0.6, y: 2.1, w: 12.1, colW: [2.5, 1.0, 4.2, 4.4],
    rowH: [0.5, 0.72, 0.72, 0.72, 0.72, 0.72],
    border: { type: "solid", color: "D8DBE6", pt: 1 },
    fontFace: BODY, fontSize: 12.5, valign: "middle",
    margin: [3, 6, 3, 6],
  });
  s.addText([
    { text: "gateway-service", options: { bold: true, color: WHITE, fontSize: 13 } },
    { text: "　為反向代理／熔斷入口（另有 1 個 /fallback 內部端點），不計入 72；", options: { color: MUTED, fontSize: 12 } },
    { text: "notification-service", options: { bold: true, color: WHITE, fontSize: 13 } },
    { text: " 走 WebSocket/STOMP（/ws），非 REST。", options: { color: MUTED, fontSize: 12 } },
  ], { x: 0.6, y: 6.45, w: 12.1, h: 0.55, fontFace: BODY, valign: "middle", lineSpacingMultiple: 1.1 });
}

// ============ 5. 依業務功能分類 ============
{
  const s = pptx.addSlide();
  chrome(s, "切法三・依業務功能", "同一批端點，改用「解決什麼問題」歸類", 5);
  const cats = [
    ["帳號與認證", 12, "登入/註冊/JWT 刷新、個資、社群綁定、停權"],
    ["錢包與金流", 12, "餘額、交易、贈禮、儲值、內部扣款入帳、死信"],
    ["鑽石與商城", 11, "鑽石兌換/換幣、商城目錄/兌換、後台發卡/上架"],
    ["遊戲玩法", 11, "老虎機、百家樂、捕魚（下注／開火／結算）"],
    ["社交好友", 6, "好友邀請、接受/拒絕、清單、刪除"],
    ["排行榜", 6, "全球／好友排行、每日贏分查詢"],
    ["後台營運", 8, "玩家管理、流通量/RTP 報表、異常告警、GM"],
    ["每日簽到", 3, "每日簽到、簽到狀態、月度獎勵"],
    ["遊戲公平性/統計", 3, "Provably Fair 驗證、RTP、遊戲歷史"],
  ];
  const maxN = 12;
  const colX = [0.6, 6.75];
  const rowH = 1.3, y0 = 2.05;
  cats.forEach(([name, n, desc], idx) => {
    const col = idx < 5 ? 0 : 1;
    const row = idx < 5 ? idx : idx - 5;
    const x = colX[col];
    const y = y0 + row * rowH;
    // 金色數字徽章
    s.addShape(pptx.ShapeType.roundRect, { x, y, w: 0.7, h: 0.7, rectRadius: 0.06, fill: { color: NAVY }, line: { color: GOLD, width: 1.25 } });
    s.addText(String(n), { x, y, w: 0.7, h: 0.7, fontFace: HEAD, fontSize: 22, bold: true, color: GOLDLT, align: "center", valign: "middle" });
    s.addText(name, { x: x + 0.9, y: y - 0.02, w: 4.9, h: 0.4, fontFace: BODY, fontSize: 15, bold: true, color: WHITE, valign: "middle" });
    // 比例條
    s.addShape(pptx.ShapeType.roundRect, { x: x + 0.9, y: y + 0.42, w: 4.8, h: 0.14, rectRadius: 0.07, fill: { color: "2C315A" } });
    s.addShape(pptx.ShapeType.roundRect, { x: x + 0.9, y: y + 0.42, w: 4.8 * (n / maxN), h: 0.14, rectRadius: 0.07, fill: { color: GOLD } });
    s.addText(desc, { x: x + 0.9, y: y + 0.6, w: 4.9, h: 0.5, fontFace: BODY, fontSize: 11, color: MUTED, valign: "top", lineSpacingMultiple: 1.05 });
  });
  s.addText("9 類合計 72，與依服務盤點一致（MECE，無重複計數）", {
    x: 0.6, y: 6.72, w: 12, h: 0.3, fontFace: BODY, fontSize: 11.5, italic: true, color: MUTED, valign: "middle",
  });
}

// ============ 6. 小結 / 設計觀察 ============
{
  const s = pptx.addSlide();
  chrome(s, "TAKEAWAYS・小結", "從 72 個端點看到的設計紀律", 6);
  const notes = [
    ["一致的路徑規約", "玩家端統一 /api/v1/**、後台 /admin/**、服務間 /internal/**，看路徑即知權限邊界。"],
    ["CQRS 與帳務分離", "wallet 讀（balance/transactions）與寫（gift/debit/credit）分流；扣款入帳走內部 API 冪等保證。"],
    ["查詢與命令分明", "rank 6 個端點全為 GET 查詢；遊戲玩法多為 POST 命令（spin/bet/shots/settle）。"],
    ["後台自成一套安全域", "獨立 ADMIN JWT，gateway 純轉發、由 admin-service 自身 Spring Security 授權。"],
  ];
  const cardW = 5.9, cardH = 1.95, gap = 0.3, x0 = 0.6, y0 = 2.1;
  notes.forEach(([t, d], i) => {
    const x = x0 + (i % 2) * (cardW + gap);
    const y = y0 + Math.floor(i / 2) * (cardH + 0.3);
    s.addShape(pptx.ShapeType.roundRect, { x, y, w: cardW, h: cardH, rectRadius: 0.06, fill: { color: CARD } });
    s.addShape(pptx.ShapeType.rect, { x, y, w: 0.11, h: cardH, fill: { color: GOLD } });
    s.addText(t, { x: x + 0.35, y: y + 0.22, w: cardW - 0.6, h: 0.5, fontFace: BODY, fontSize: 17, bold: true, color: INK, valign: "middle" });
    s.addText(d, { x: x + 0.35, y: y + 0.78, w: cardW - 0.65, h: 1.05, fontFace: BODY, fontSize: 13, color: SLATE, valign: "top", lineSpacingMultiple: 1.2 });
  });
}

const out = path.join(__dirname, "幸運星幣城-API盤點與分類.pptx");
await pptx.writeFile({ fileName: out });
console.log("written:", out);
