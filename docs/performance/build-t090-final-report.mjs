// T-090 效能戰役 — 期末報告＋面試腳本 簡報產生器
// 樣板：docs/report/幸運星幣城-API盤點與分類.backup-20260724-145533-preappendix.pptx（深藍底＋金色點綴，PptxGenJS）
// 內容來源：docs/performance/T-090-期末報告-分機推估與面試腳本.md
// 執行：node docs/performance/build-t090-final-report.mjs
import PptxGenJS from "pptxgenjs";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---- 設計 token（沿用樣板）----
const NAVY = "141833";
const NAVY2 = "1B1F3B";
const CARD = "F4F5F9";
const INK = "1B1F3B";
const SLATE = "4A4E68";
const MUTED = "8A8FB0";
const GOLD = "C9A227";
const GOLDLT = "E4C766";
const WHITE = "FFFFFF";
const BLUE = "CADCFC";
const RED = "B23A3A";
const HEAD = "Cambria";
const BODY = "Calibri";

const pptx = new PptxGenJS();
pptx.defineLayout({ name: "W16x9", width: 13.333, height: 7.5 });
pptx.layout = "W16x9";
pptx.author = "Lucky Star Casino";
pptx.company = "PptxGenJS";

function chrome(slide, kicker, title, pageNo) {
  slide.background = { color: NAVY2 };
  slide.addText(kicker, {
    x: 0.6, y: 0.4, w: 9, h: 0.35, fontFace: BODY, fontSize: 12, bold: true,
    color: GOLD, charSpacing: 2, valign: "middle",
  });
  slide.addText(title, {
    x: 0.6, y: 0.74, w: 11.9, h: 0.68, fontFace: BODY, fontSize: 26, bold: true,
    color: WHITE, valign: "middle",
  });
  slide.addShape(pptx.ShapeType.rect, { x: 0.62, y: 1.42, w: 1.2, h: 0.05, fill: { color: GOLD } });
  slide.addText("T-090 效能戰役｜期末報告＋面試腳本", {
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
    x: 0.9, y: 1.5, w: 8, h: 0.6, fontFace: BODY, fontSize: 22, bold: true, color: GOLDLT, charSpacing: 4, valign: "middle",
  });
  s.addText("T-090 效能戰役", {
    x: 0.9, y: 2.15, w: 11.6, h: 1.0, fontFace: HEAD, fontSize: 46, bold: true, color: WHITE, charSpacing: 1, valign: "middle",
  });
  s.addText("期末報告＋面試腳本（含分機推估情境）", {
    x: 0.92, y: 3.2, w: 11, h: 0.6, fontFace: BODY, fontSize: 20, color: BLUE, valign: "middle",
  });
  const bullets = [
    ["200", "req/s 單機容量"],
    ["575", "tx/s DB 天花板"],
    ["0", "帳務違規"],
  ];
  bullets.forEach(([n, t], i) => {
    const x = 0.92 + i * 3.9;
    s.addShape(pptx.ShapeType.ellipse, { x, y: 4.5, w: 0.16, h: 0.16, fill: { color: GOLD } });
    s.addText([
      { text: n + "  ", options: { bold: true, color: GOLDLT, fontSize: 22 } },
      { text: t, options: { color: WHITE, fontSize: 16 } },
    ], { x: x + 0.28, y: 4.28, w: 3.4, h: 0.6, fontFace: BODY, valign: "middle" });
  });
  s.addText("⚠ 分機壓測尚未實跑，本文推估段落一律標【推估】，不可講成實測", {
    x: 0.92, y: 5.15, w: 11.2, h: 0.4, fontFace: BODY, fontSize: 13, italic: true, color: "E8B4B4", valign: "middle",
  });
  s.addText("資料來源：PR #86～#265 實測紀錄、docs/performance/*（2026-07-24）", {
    x: 0.92, y: 6.75, w: 11, h: 0.4, fontFace: BODY, fontSize: 12, color: MUTED, valign: "middle",
  });
}

// ============ 2. 誠信紅線 ============
{
  const s = pptx.addSlide();
  chrome(s, "GROUND RULES・使用須知", "誠信紅線：實測 vs 推估，不可混講", 2);
  const header = [
    { text: "類別", options: { bold: true, color: WHITE, fill: { color: GOLD } } },
    { text: "標記", options: { bold: true, color: WHITE, fill: { color: GOLD } } },
    { text: "可否當「實測」講", options: { bold: true, color: WHITE, fill: { color: GOLD } } },
  ];
  const rows = [
    ["實測（co-located，同機自壓）", "無標記／「實測」", "✅ 可，但要附「同機、絕對值為悲觀下界」"],
    ["推估（分機情境）", "全部標【推估】", "❌ 不可，只能講「我推估…，推導如下」"],
  ];
  const body = rows.map((r, i) => r.map((c, j) => ({
    text: c,
    options: {
      fill: { color: i % 2 ? "EEF0F6" : "FFFFFF" },
      color: j === 0 ? INK : SLATE, bold: j === 0,
      fontSize: 13,
    },
  })));
  s.addTable([header, ...body], {
    x: 0.6, y: 1.85, w: 12.1, colW: [3.6, 3.0, 5.5],
    rowH: [0.5, 0.85, 0.85],
    border: { type: "solid", color: "D8DBE6", pt: 1 },
    fontFace: BODY, fontSize: 13, valign: "middle", margin: [4, 8, 4, 8],
  });
  s.addShape(pptx.ShapeType.roundRect, { x: 0.6, y: 4.35, w: 12.1, h: 1.55, rectRadius: 0.08, fill: { color: CARD } });
  s.addShape(pptx.ShapeType.rect, { x: 0.6, y: 4.35, w: 0.11, h: 1.55, fill: { color: RED } });
  s.addText([
    { text: "為什麼是紅線　", options: { bold: true, color: INK, fontSize: 14 } },
    { text: "把推估講成實測、被追問細節時穿幫 ＝ 誠信崩盤，比數字小一百倍嚴重。分機尚未實跑（單機環境所限），本文推估是情境規劃（scenario planning）——前提是誠實標示。", options: { color: SLATE, fontSize: 13 } },
  ], { x: 0.85, y: 4.5, w: 11.6, h: 1.25, fontFace: BODY, valign: "top", lineSpacingMultiple: 1.25 });
  s.addText("特別警告：不要宣稱「支援 10 萬人在線」——單副本、單機、7 服務共擠 12 核，架構上無水平擴展（見 §6 SPOF）。", {
    x: 0.6, y: 6.15, w: 12.1, h: 0.6, fontFace: BODY, fontSize: 12.5, italic: true, color: "E8B4B4", valign: "middle",
  });
}

// ============ 3. 戰役時間軸 ============
{
  const s = pptx.addSlide();
  chrome(s, "TIMELINE・戰役故事線", "過去遇到什麼問題 → 做了什麼改變", 3);
  const header = ["幕", "遇到的問題", "做的改變", "實測結果"].map(t => ({
    text: t, options: { bold: true, color: WHITE, fill: { color: GOLD }, fontSize: 11.5 },
  }));
  const rows = [
    ["第一幕\n07-08", "1,000 併發失敗率 89.3%，gateway 反覆熔斷", "補 timelimiter.timeout-duration: 6s", "150 併發 5xx 78%→0"],
    ["第二幕\n07-08", "wallet debit 96→547ms 劣化、401 雪崩", "風控移出熱路徑；C1 在途上限 200；C2 Redis backoff", "1,000 併發成功 +126%，spin 5.21s→2.65s"],
    ["第三幕\n07-09", "debit 劣化真因？", "B1 JFR 剖析：排除連線池／表膨脹，定位 DB 交易容量", "單機 Postgres ≈550–600 tx/s＝真天花板"],
    ["第四幕\n07-09", "固定上限 200 是拍腦袋", "C3 AIMD 自適應在途上限（同 TCP 壅塞控制）", "150 併發 P99 −48%，1,000 併發成功 +430%"],
    ["第二輪\n07-17~18", "AIMD 與 CB 互踩、卸載污染統計", "E1 CB 時間窗；E2 AIMD 排除卸載樣本；B2 debit 4→2 往返", "150 P99 −21.7%"],
    ["量測基建\n07-22", "舊 harness 會靜默出假數據", "P0~P6：open-model／暖機／CPU 隔離／三道守衛", "數據可信度補齊"],
    ["新環境重跑\n07-24", "驗證瓶頸複驗＋堆衛生", "co-located 25~300 併發階梯重跑", "150 併發首次零卸載撐住，對帳 9/9"],
  ];
  const body = rows.map((r, i) => r.map((c, j) => ({
    text: c,
    options: {
      fill: { color: i % 2 ? "EEF0F6" : "FFFFFF" },
      color: j === 0 ? GOLD : (j === 3 ? INK : SLATE),
      bold: j === 0 || j === 3,
      fontSize: 10.5,
    },
  })));
  s.addTable([header, ...body], {
    x: 0.5, y: 1.75, w: 12.3, colW: [1.7, 3.6, 3.9, 3.1],
    rowH: [0.4, 0.62, 0.62, 0.62, 0.62, 0.62, 0.62, 0.62],
    border: { type: "solid", color: "D8DBE6", pt: 1 },
    fontFace: BODY, valign: "middle", margin: [3, 5, 3, 5],
  });
  s.addText("★ 每一輪帳務不變量都是 0 違規", {
    x: 9.3, y: 0.4, w: 3.4, h: 0.35, fontFace: BODY, fontSize: 11, bold: true, color: GOLDLT, align: "right", valign: "middle",
  });
}

// ============ 4. 實測錨點 ============
{
  const s = pptx.addSlide();
  chrome(s, "REAL DATA・實測錨點", "真數據，可直接講（co-located 同機自壓）", 4);
  const stats = [
    ["150", "併發乾淨扛住膝點", "0 卸載，P99 ~1.7s"],
    ["200", "req/s 全鏈路容量", "含 gateway/JWT/風控/扣款/派彩"],
    ["575", "tx/s DB 交易容量", "JFR 定位，真天花板"],
    ["0", "帳務違規", "overdraw／冪等／對帳皆 0"],
  ];
  const tileW = 2.85, gap = 0.33, x0 = 0.6, y = 1.85, h = 1.85;
  stats.forEach(([n, label, sub], i) => {
    const x = x0 + i * (tileW + gap);
    s.addShape(pptx.ShapeType.roundRect, { x, y, w: tileW, h, rectRadius: 0.08, fill: { color: CARD } });
    s.addShape(pptx.ShapeType.rect, { x, y, w: tileW, h: 0.09, fill: { color: GOLD } });
    s.addText(n, { x, y: y + 0.18, w: tileW, h: 0.75, fontFace: HEAD, fontSize: 38, bold: true, color: INK, align: "center", valign: "middle" });
    s.addText(label, { x, y: y + 0.95, w: tileW, h: 0.4, fontFace: BODY, fontSize: 13.5, bold: true, color: INK, align: "center", valign: "middle" });
    s.addText(sub, { x, y: y + 1.35, w: tileW, h: 0.45, fontFace: BODY, fontSize: 10.5, color: SLATE, align: "center", valign: "middle" });
  });
  s.addText("2.1 最新一輪實測階梯（PR #265，2026-07-24）", {
    x: 0.6, y: 4.0, w: 10, h: 0.4, fontFace: BODY, fontSize: 15, bold: true, color: BLUE, valign: "middle",
  });
  const header = ["併發", "accepted 吞吐", "P99", "卸載率", "JMeter CPU"].map(t => ({
    text: t, options: { bold: true, color: WHITE, fill: { color: GOLD }, align: "center", fontSize: 12 },
  }));
  const rows = [
    ["25", "50/s", "58ms", "0%", "1.7%"],
    ["50", "100/s", "117ms", "0%", "4.3%"],
    ["100", "198/s", "912ms", "0%", "18.6%"],
    ["150", "219/s", "1,731ms", "0%", "24.5%"],
    ["300", "154/s", "1,488ms", "74.3%", "35%（打折）"],
  ];
  const body = rows.map((r, i) => r.map((c) => ({
    text: c,
    options: { fill: { color: i % 2 ? "EEF0F6" : "FFFFFF" }, color: SLATE, align: "center", fontSize: 12 },
  })));
  s.addTable([header, ...body], {
    x: 0.6, y: 4.45, w: 12.1, colW: [2.42, 2.42, 2.42, 2.42, 2.42],
    rowH: [0.42, 0.4, 0.4, 0.4, 0.4, 0.4],
    border: { type: "solid", color: "D8DBE6", pt: 1 },
    fontFace: BODY, valign: "middle", margin: [3, 6, 3, 6],
  });
  s.addText("co-located 污染證據：JMeter 自身吃 24–35% CPU；knee 正好落在 JMeter CPU 破 25% 之處。", {
    x: 0.6, y: 6.75, w: 12.1, h: 0.3, fontFace: BODY, fontSize: 11, italic: true, color: MUTED, valign: "middle",
  });
}

// ============ 5. 推估情境：推導方法 ============
{
  const s = pptx.addSlide();
  chrome(s, "【推估】・分機壓測情境", "推導方法（面試被追問就講這段）", 5);
  s.addShape(pptx.ShapeType.roundRect, { x: 0.6, y: 1.75, w: 12.1, h: 0.55, rectRadius: 0.06, fill: { color: "3A2323" } });
  s.addText("⚠ 本節全部是推估，尚未實跑。標題、表格、講稿都必須帶「推估」二字。", {
    x: 0.8, y: 1.75, w: 11.7, h: 0.55, fontFace: BODY, fontSize: 13, bold: true, color: "F0B4B4", valign: "middle",
  });
  const steps = [
    ["1", "分機做的事", "把 JMeter 移出 SUT，還給服務原本被偷走的 ~25–35% CPU。"],
    ["2", "但 SUT 仍是一台筆電", "7 個 JVM＋PostgreSQL＋MySQL＋Kafka 還是共擠 12 核 —— 分機不會讓容量跳數量級。"],
    ["3", "真天花板是 DB，不是 app", "JFR 實測單機 Postgres debit ≈550–600 tx/s；每 spin ≈1.3 次帳務寫入 → 寫入預算÷1.3 ≈ ~440 spins/s 理論上界。"],
    ["4", "結論", "分機推估乾淨吞吐 ≈350–450 spins/s，膝點併發推估 ~250–350。這是有實測錨點夾出來的區間，不是憑空喊的。"],
  ];
  const y0 = 2.55, rowH = 1.0;
  steps.forEach(([n, t, d], i) => {
    const y = y0 + i * rowH;
    s.addShape(pptx.ShapeType.roundRect, { x: 0.6, y, w: 0.55, h: 0.55, rectRadius: 0.06, fill: { color: NAVY }, line: { color: GOLD, width: 1.25 } });
    s.addText(n, { x: 0.6, y, w: 0.55, h: 0.55, fontFace: HEAD, fontSize: 18, bold: true, color: GOLDLT, align: "center", valign: "middle" });
    s.addText(t, { x: 1.35, y: y - 0.02, w: 3.1, h: 0.55, fontFace: BODY, fontSize: 14, bold: true, color: WHITE, valign: "middle" });
    s.addText(d, { x: 4.6, y: y - 0.05, w: 8.1, h: 0.85, fontFace: BODY, fontSize: 12, color: MUTED, valign: "middle", lineSpacingMultiple: 1.15 });
  });
}

// ============ 6. 推估容量階梯 ============
{
  const s = pptx.addSlide();
  chrome(s, "【推估】・分機容量階梯", "假設：分機施壓、SUT 仍為同一台 12 核筆電", 6);
  const header = ["併發", "【推估】吞吐", "【推估】P99", "【推估】卸載率", "說明"].map(t => ({
    text: t, options: { bold: true, color: WHITE, fill: { color: GOLD }, align: "center", fontSize: 11.5 },
  }));
  const rows = [
    ["50", "~100/s", "~80ms", "0%", "遠低於容量，延遲≈實測"],
    ["100", "~200/s", "~300ms", "0%", "施壓機 CPU 還給 SUT"],
    ["200", "~380/s", "~700ms", "0%", "接近 app/DB 交界"],
    ["300", "~430/s", "~1,100ms", "~5%", "逼近 DB 寫入上界，AIMD 輕微卸載"],
    ["500", "~440/s", "~1,400ms", "~20%", "膝點後：吞吐持平於 DB 天花板"],
    ["800", "~440/s", "~1,600ms", "~45%", "吞吐飽和不再上升"],
  ];
  const body = rows.map((r, i) => r.map((c, j) => ({
    text: c,
    options: {
      fill: { color: i % 2 ? "EEF0F6" : "FFFFFF" },
      color: j === 4 ? SLATE : GOLD, bold: j !== 4,
      align: j === 4 ? "left" : "center", fontSize: 12,
    },
  })));
  s.addTable([header, ...body], {
    x: 0.6, y: 1.85, w: 12.1, colW: [1.5, 2.2, 2.2, 2.2, 4.0],
    rowH: [0.42, 0.55, 0.55, 0.55, 0.55, 0.55, 0.55],
    border: { type: "solid", color: "D8DBE6", pt: 1 },
    fontFace: BODY, valign: "middle", margin: [3, 6, 3, 6],
  });
  s.addShape(pptx.ShapeType.roundRect, { x: 0.6, y: 5.85, w: 12.1, h: 1.0, rectRadius: 0.08, fill: { color: CARD } });
  s.addShape(pptx.ShapeType.rect, { x: 0.6, y: 5.85, w: 0.11, h: 1.0, fill: { color: GOLD } });
  s.addText("這張圖的價值：吞吐在 ~440/s 持平封頂、超額全變卸載 —— 這條「水平線」就是單機 DB 天花板的視覺化證據。再調 app 旋鈕都頂不破這條線，要破只能動 DB 拓樸。", {
    x: 0.85, y: 5.85, w: 11.6, h: 1.0, fontFace: BODY, fontSize: 12.5, color: SLATE, valign: "middle", lineSpacingMultiple: 1.2,
  });
}

// ============ 7. 最終版狀態 ============
{
  const s = pptx.addSlide();
  chrome(s, "DELIVERED・最終版狀態", "已落地並驗證 vs 已知邊界", 7);
  s.addText("✅ 已落地並驗證", { x: 0.6, y: 1.75, w: 6, h: 0.4, fontFace: BODY, fontSize: 15, bold: true, color: GOLDLT, valign: "middle" });
  const done = [
    "全鏈路壓測框架：open-model 階梯、暖機、CPU 隔離、三道守衛",
    "入口保護：gateway AIMD 自適應在途上限，全路徑納管",
    "熱路徑優化：風控移出熱路徑、debit 往返 4→2、HikariCP 上調、outbox 平行 ack",
    "可觀測性：七服務 Prometheus 指標、Tomcat mbean、Grafana 儀表板",
    "設定衛生：-Xmx1g ＋ mem_limit 1280m 防 JVM 堆超賣",
    "帳務正確性：T-091 九項 SQL 對帳，全部輪次 0 違規",
    "瓶頸歸因：六個常見調校方向實測逐一否證，真瓶頸定位到 co-located CPU／單機 DB 交易容量",
  ];
  let y = 2.2;
  done.forEach((t) => {
    s.addShape(pptx.ShapeType.ellipse, { x: 0.65, y: y + 0.08, w: 0.13, h: 0.13, fill: { color: GOLD } });
    s.addText(t, { x: 0.95, y: y - 0.03, w: 11.6, h: 0.42, fontFace: BODY, fontSize: 12.5, color: WHITE, valign: "middle" });
    y += 0.42;
  });
  s.addText("已知邊界（誠實講）", { x: 0.6, y: y + 0.15, w: 6, h: 0.4, fontFace: BODY, fontSize: 15, bold: true, color: "E8B4B4", valign: "middle" });
  y += 0.6;
  const bounds = [
    "單機全鏈路 ~200 req/s（實測，co-located）",
    "單機 Postgres debit ~550–600 tx/s（JFR，真天花板）",
    "分機真實容量尚未實測（§3 為推估）",
  ];
  bounds.forEach((t) => {
    s.addShape(pptx.ShapeType.ellipse, { x: 0.65, y: y + 0.08, w: 0.13, h: 0.13, fill: { color: RED } });
    s.addText(t, { x: 0.95, y: y - 0.03, w: 11.6, h: 0.4, fontFace: BODY, fontSize: 12.5, color: MUTED, valign: "middle" });
    y += 0.4;
  });
}

// ============ 8. 併發 → 在線人數情境 ============
{
  const s = pptx.addSlide();
  chrome(s, "【推估／情境】・併發 → 在線人數", "換算情境，不是實測人數", 8);
  s.addText([
    { text: "併發", options: { bold: true, color: WHITE } },
    { text: "＝同一瞬間在途的請求數；", options: { color: MUTED } },
    { text: "在線人數", options: { bold: true, color: WHITE } },
    { text: "＝掛著的玩家（大部分時間在看牌/選注/發呆）。兩者差很多。", options: { color: MUTED } },
  ], { x: 0.6, y: 1.85, w: 12.1, h: 0.55, fontFace: BODY, fontSize: 13.5, valign: "middle" });

  const cards = [
    ["實測膝點", "150 併發", "÷ 2% 佔用率", "≈ 7,500 名", "「這種節奏」的在線玩家"],
    ["分機推估膝點", "~300 併發", "÷ 2% 佔用率", "≈ 1.5 萬名", "在線玩家（推估）"],
  ];
  const cardW = 5.9, gap = 0.3, x0 = 0.6, y = 2.6, h = 2.1;
  cards.forEach(([tag, a, b, n, label], i) => {
    const x = x0 + i * (cardW + gap);
    s.addShape(pptx.ShapeType.roundRect, { x, y, w: cardW, h, rectRadius: 0.08, fill: { color: CARD } });
    s.addShape(pptx.ShapeType.rect, { x, y, w: cardW, h: 0.09, fill: { color: GOLD } });
    s.addText(tag, { x: x + 0.35, y: y + 0.22, w: cardW - 0.7, h: 0.35, fontFace: BODY, fontSize: 12, bold: true, color: SLATE, valign: "middle" });
    s.addText(`${a}  ${b}`, { x: x + 0.35, y: y + 0.55, w: cardW - 0.7, h: 0.4, fontFace: BODY, fontSize: 13, color: SLATE, valign: "middle" });
    s.addText(n, { x: x + 0.35, y: y + 0.95, w: cardW - 0.7, h: 0.75, fontFace: HEAD, fontSize: 34, bold: true, color: INK, valign: "middle" });
    s.addText(label, { x: x + 0.35, y: y + 1.65, w: cardW - 0.7, h: 0.35, fontFace: BODY, fontSize: 11.5, color: SLATE, valign: "middle" });
  });

  s.addShape(pptx.ShapeType.roundRect, { x: 0.6, y: 5.0, w: 12.1, h: 1.75, rectRadius: 0.08, fill: { color: "23273F" } });
  s.addText("換算假設：一個玩家平均每 5 秒 spin 一次、一次 spin 佔用伺服器 ~0.1 秒 → 單一玩家只佔請求槽 2% 時間。", {
    x: 0.85, y: 5.15, w: 11.6, h: 0.5, fontFace: BODY, fontSize: 12.5, color: BLUE, valign: "middle",
  });
  s.addText("絕不要說：「我的系統支援 X 萬人在線」（把推估講成事實）。真要拍板得用真實玩家行為數據跑一次。", {
    x: 0.85, y: 5.65, w: 11.6, h: 0.9, fontFace: BODY, fontSize: 12.5, italic: true, color: "E8B4B4", valign: "middle", lineSpacingMultiple: 1.2,
  });
}

// ============ 9. Roadmap ============
{
  const s = pptx.addSlide();
  chrome(s, "ROADMAP・還能怎麼加 RPS", "順序＝先驗證再動手、先低風險再動地基", 9);
  const header = ["優先", "動作", "解什麼瓶頸", "風險"].map(t => ({
    text: t, options: { bold: true, color: WHITE, fill: { color: GOLD }, fontSize: 11.5 },
  }));
  const rows = [
    ["P0", "分機重測（JMeter 移出 SUT）", "拿掉施壓機 CPU 污染，驗證 §3 推估", "低"],
    ["P1", "gateway 多副本＋解 outbox 互斥", "單一 reactive 實例＝SPOF", "中"],
    ["P1", "前端優雅接 429（backoff＋UI）", "高卸載時的體驗", "低"],
    ["P2", "DB 垂直擴容／讀寫分離", "單機 Postgres 550–600 tx/s 天花板", "中"],
    ["P2", "熱路徑非同步化", "game→wallet 同步耦合 ~130ms", "中"],
    ["P3", "帳務層批次合併寫入", "DB 交易數本身", "高（動帳務地基）"],
    ["P3", "熱點帳戶分片／分庫分表", "單庫寫入熱點", "高（架構級改動）"],
  ];
  const body = rows.map((r, i) => r.map((c, j) => ({
    text: c,
    options: {
      fill: { color: i % 2 ? "EEF0F6" : "FFFFFF" },
      color: j === 0 ? GOLD : (j === 3 && c.includes("高") ? RED : SLATE),
      bold: j === 0,
      fontSize: 11.5,
    },
  })));
  s.addTable([header, ...body], {
    x: 0.6, y: 1.75, w: 12.1, colW: [1.1, 4.9, 4.4, 1.7],
    rowH: [0.4, 0.62, 0.62, 0.62, 0.62, 0.62, 0.62, 0.62],
    border: { type: "solid", color: "D8DBE6", pt: 1 },
    fontFace: BODY, valign: "middle", margin: [3, 6, 3, 6],
  });
  s.addText("核心原則：每一步都先量測再動手，不跳步。", {
    x: 0.6, y: 6.85, w: 12.1, h: 0.3, fontFace: BODY, fontSize: 12, italic: true, color: MUTED, valign: "middle",
  });
}

// ============ 10. 面試逐題精華 ============
{
  const s = pptx.addSlide();
  chrome(s, "Q&A・面試逐題腳本精華", "練到反射：核心一句話", 10);
  const qa = [
    ["怎麼做效能測試？", "JMeter open-model 全鏈路壓，跑容量階梯而非單點，gate 拆效能與帳務兩組分判。"],
    ["P99 沒過 gate，算成功嗎？", "算。拿到真實邊界＋過載安全卸載不壞帳，這結論本身就是最值錢的產出。"],
    ["分機會快多少？", "我推估約 350–450/s、在線約 1.5 萬。但這是推估，分機還沒實跑，所以 P0 就是分機重測。"],
    ["高併發下帳會不會算錯？", "效能 gate FAIL 過很多輪，帳務 gate 一輪都沒 FAIL —— 正確性和效能解耦。"],
  ];
  const cardW = 5.9, cardH = 2.05, gap = 0.3, x0 = 0.6, y0 = 1.85;
  qa.forEach(([q, a], i) => {
    const x = x0 + (i % 2) * (cardW + gap);
    const y = y0 + Math.floor(i / 2) * (cardH + 0.3);
    s.addShape(pptx.ShapeType.roundRect, { x, y, w: cardW, h: cardH, rectRadius: 0.06, fill: { color: CARD } });
    s.addShape(pptx.ShapeType.rect, { x, y, w: 0.11, h: cardH, fill: { color: GOLD } });
    s.addText("Q：" + q, { x: x + 0.35, y: y + 0.2, w: cardW - 0.6, h: 0.55, fontFace: BODY, fontSize: 14.5, bold: true, color: INK, valign: "middle" });
    s.addText("A：" + a, { x: x + 0.35, y: y + 0.78, w: cardW - 0.65, h: 1.15, fontFace: BODY, fontSize: 12, color: SLATE, valign: "top", lineSpacingMultiple: 1.2 });
  });
}

// ============ 11. 事實速查（收尾）============
{
  const s = pptx.addSlide();
  chrome(s, "FACT CHECK・事實速查", "別背錯：實測 vs 推估一覽", 11);
  const header = ["事實", "數字", "類別"].map(t => ({
    text: t, options: { bold: true, color: WHITE, fill: { color: GOLD }, fontSize: 12.5 },
  }));
  const rows = [
    ["單機全鏈路容量", "~200 req/s", "實測"],
    ["單機 Postgres debit 容量", "550–600 tx/s", "實測（JFR）"],
    ["TimeLimiter 修正（150 併發 5xx）", "78% → 0", "實測"],
    ["C3+B1 重跑（150 併發 P99）", "2,753 → 1,423ms（−48%）", "實測"],
    ["B2 debit DB 往返", "4 → 2（150 P99 −21.7%）", "實測"],
    ["最新輪（150 併發）", "219/s、P99 1,731ms、0 卸載", "實測（#265）"],
    ["帳務違規（全輪次）", "overdraw 0／冪等 0／對帳 0", "實測"],
    ["分機乾淨吞吐", "~350–450 spins/s", "【推估】"],
    ["分機在線人數", "~1.5 萬（假設 5s/注）", "【推估／情境】"],
  ];
  const body = rows.map((r, i) => r.map((c, j) => ({
    text: c,
    options: {
      fill: { color: i % 2 ? "EEF0F6" : "FFFFFF" },
      color: j === 2 ? (c.includes("推估") ? RED : "2E7D46") : (j === 0 ? INK : SLATE),
      bold: j === 2,
      fontSize: 11.5,
    },
  })));
  s.addTable([header, ...body], {
    x: 0.6, y: 1.75, w: 12.1, colW: [5.3, 4.5, 2.3],
    rowH: [0.4, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5],
    border: { type: "solid", color: "D8DBE6", pt: 1 },
    fontFace: BODY, valign: "middle", margin: [3, 6, 3, 6],
  });
  s.addText("本文推估部分為情境規劃，分機壓測尚未實跑；正式引用前須依 §6 P0 分機重測取得實測值。", {
    x: 0.6, y: 6.95, w: 12.1, h: 0.35, fontFace: BODY, fontSize: 11, italic: true, color: MUTED, valign: "middle",
  });
}

const out = path.join(__dirname, "T-090-期末報告-分機推估與面試腳本.pptx");
await pptx.writeFile({ fileName: out });
console.log("written:", out);
