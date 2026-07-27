#!/usr/bin/env node
/**
 * 依 git commit 產生「團隊貢獻度」圓餅圖（SVG，可直接插入 PowerPoint）。
 *
 * 為什麼是 SVG 不是 PNG：PPT 支援直接插入 SVG，是向量，投影/放大不糊，
 * 而且插入後可在 PPT 內「轉換成圖形」改字改色，不必回來重產。
 *
 * 身分收斂靠工作目錄的 .mailmap（%aN 會套用），所以同一人多組 name/email
 * 會自動合併，不需要改寫 git 歷史。
 *
 *   node tools/contribution/generate-contribution-charts.mjs [--ref develop]
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REF = (() => {
  const i = process.argv.indexOf('--ref');
  return i >= 0 ? process.argv[i + 1] : 'develop';
})();

const OUT_DIR = resolve(process.cwd(), 'docs/report/contribution');

/** 人 → 顏色。顏色綁「人」不綁「名次」，所以同一人在每張圖都是同一色。 */
const PEOPLE = [
  { name: '張鈞皓', role: '組長 A', color: '#2a78d6' },
  { name: '林暐彧', role: '組員 C', color: '#eb6834' },
  { name: '王竣揚', role: '組員 E', color: '#1baf7a' },
  { name: '許銘仁', role: '組員 D', color: '#4a3aa7' },
];

/** 五張圖：整體一張 + 四個面向。paths 空陣列＝整個 repo。 */
const CHARTS = [
  { id: 'overall', title: '整體 commit 貢獻佔比', note: 'develop 全部 commit（不含 merge）', paths: [] },
  { id: 'backend', title: '後端服務', note: 'backend/（7 個 Spring Boot 服務）', paths: ['backend'] },
  { id: 'frontend', title: '前端', note: 'frontend/ + frontend-admin/', paths: ['frontend', 'frontend-admin'] },
  {
    id: 'infra',
    title: '資料庫・基礎設施・測試・CI',
    note: 'database/ kafka/ tools/ tests/ .github/ docker-compose.yml',
    paths: ['database', 'kafka', 'tools', 'tests', '.github', 'docker-compose.yml'],
  },
  { id: 'docs', title: '文件與規劃', note: 'docs/（架構文件、ADR、壓測報告、計畫書）', paths: ['docs'] },
];

const SURFACE = '#fcfcfb';
const INK = '#0b0b0b';
const INK_2 = '#52514e';
const INK_MUTED = '#898781';
const FONT = 'system-ui, -apple-system, "Segoe UI", "Microsoft JhengHei", sans-serif';

function commitCounts(paths) {
  const args = ['log', '--no-merges', '--pretty=format:%aN', REF];
  if (paths.length) args.push('--', ...paths);
  const out = execFileSync('git', args, { encoding: 'utf8' });
  const tally = new Map(PEOPLE.map((p) => [p.name, 0]));
  for (const line of out.split('\n')) {
    const name = line.trim();
    if (!name) continue;
    if (!tally.has(name)) throw new Error(`未知作者「${name}」：請補進 .mailmap 或 PEOPLE`);
    tally.set(name, tally.get(name) + 1);
  }
  return PEOPLE.map((p) => ({ ...p, value: tally.get(p.name) }))
    .filter((s) => s.value > 0)
    .sort((a, b) => b.value - a.value);
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const fmtPct = (v, total) => `${((v / total) * 100).toFixed(1)}%`;

/** 圓餅切片路徑。0° 在 12 點鐘方向，順時針。 */
function slicePath(cx, cy, r, startDeg, endDeg) {
  const pt = (deg) => {
    const rad = ((deg - 90) * Math.PI) / 180;
    return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
  };
  if (endDeg - startDeg >= 359.999) {
    // 單人 100%：兩段半圓，避免 arc 起訖同點畫不出來
    const [ax, ay] = pt(0);
    const [bx, by] = pt(180);
    return `M ${ax} ${ay} A ${r} ${r} 0 1 1 ${bx} ${by} A ${r} ${r} 0 1 1 ${ax} ${ay} Z`;
  }
  const [x1, y1] = pt(startDeg);
  const [x2, y2] = pt(endDeg);
  const large = endDeg - startDeg > 180 ? 1 : 0;
  return `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`;
}

function sliceGeometry(series, total) {
  let acc = 0;
  return series.map((s) => {
    const start = (acc / total) * 360;
    acc += s.value;
    const end = (acc / total) * 360;
    return { ...s, start, end, mid: (start + end) / 2 };
  });
}

/** 同側標籤依 y 由上而下推開，避免小切片標籤疊字。 */
function spreadLabels(labels, minGap) {
  const byY = [...labels].sort((a, b) => a.y - b.y);
  for (let i = 1; i < byY.length; i += 1) {
    const gap = byY[i].y - byY[i - 1].y;
    if (gap < minGap) byY[i].y = byY[i - 1].y + minGap;
  }
  return labels;
}

/** 切片上的字用黑或白？取對比較高的那個，不用眼睛猜。 */
function bestInk(hex) {
  const channel = (c) => {
    const v = parseInt(hex.slice(1 + c * 2, 3 + c * 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const lum = 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
  const onWhite = 1.05 / (lum + 0.05);
  const onBlack = (lum + 0.05) / 0.05;
  return onWhite >= onBlack ? '#ffffff' : INK;
}

/** 切片夠大就把百分比標在圓內；標籤不外擴，右側資料面板才不會被撞到。 */
function insideLabels(geo, total, cx, cy, r, minPct, fontSize) {
  return geo
    .filter((s) => s.value / total >= minPct)
    .map((s) => {
      const rad = ((s.mid - 90) * Math.PI) / 180;
      const x = cx + r * 0.62 * Math.cos(rad);
      const y = cy + r * 0.62 * Math.sin(rad);
      return `    <text x="${x.toFixed(1)}" y="${(y + fontSize * 0.35).toFixed(1)}" text-anchor="middle" font-family="${FONT}" font-size="${fontSize}" font-weight="700" fill="${bestInk(s.color)}" style="font-variant-numeric:tabular-nums">${fmtPct(s.value, total)}</text>`;
    })
    .join('\n');
}

function pieSlices(geo, cx, cy, r) {
  // stroke 用 surface 色＝切片之間 2px 的呼吸縫，靠色相以外的線索分界
  return geo
    .map(
      (s) =>
        `    <path d="${slicePath(cx, cy, r, s.start, s.end)}" fill="${s.color}" stroke="${SURFACE}" stroke-width="2" stroke-linejoin="round"/>`
    )
    .join('\n');
}

/** 主圖：大圓餅（大切片內標％、小切片拉引線）+ 右側成員圖例。 */
function heroSvg(chart, series) {
  const W = 940;
  const H = 560;
  const cx = 288;
  const cy = 306;
  const r = 168;
  const total = series.reduce((n, s) => n + s.value, 0);
  const geo = sliceGeometry(series, total);

  // 只有小到塞不進圓內的切片才外標，且一律往左拉，不會伸進右側面板
  const labels = geo
    .filter((s) => s.value / total < 0.07)
    .map((s) => {
      const rad = ((s.mid - 90) * Math.PI) / 180;
      return {
        ...s,
        ax: cx + (r + 6) * Math.cos(rad),
        ay: cy + (r + 6) * Math.sin(rad),
        x: cx + (r + 30) * Math.cos(rad),
        y: cy + (r + 30) * Math.sin(rad),
      };
    });
  spreadLabels(labels, 34);

  const leaders = labels
    .map(
      (l) =>
        `    <polyline points="${l.ax.toFixed(1)},${l.ay.toFixed(1)} ${l.x.toFixed(1)},${l.y.toFixed(1)} ${(l.x - 14).toFixed(1)},${l.y.toFixed(1)}" fill="none" stroke="${INK_MUTED}" stroke-width="1"/>`
    )
    .join('\n');

  const labelText = labels
    .map(
      (l) =>
        `    <text x="${(l.x - 20).toFixed(1)}" y="${(l.y + 5).toFixed(1)}" text-anchor="end" font-family="${FONT}" font-size="16" font-weight="650" fill="${INK}" style="font-variant-numeric:tabular-nums">${esc(l.name)}　${fmtPct(l.value, total)}</text>`
    )
    .join('\n');

  // 右側圖例：色塊 + 姓名 + 角色 + 數字，識別不只靠顏色
  const legendX = 610;
  const legend = geo
    .map((s, i) => {
      const y = 216 + i * 52;
      return `    <rect x="${legendX}" y="${y - 11}" width="14" height="14" rx="3" fill="${s.color}"/>
    <text x="${legendX + 24}" y="${y}" font-family="${FONT}" font-size="17" font-weight="600" fill="${INK}">${esc(s.name)}</text>
    <text x="${legendX + 24}" y="${y + 20}" font-family="${FONT}" font-size="13" fill="${INK_MUTED}">${esc(s.role)}</text>
    <text x="${W - 40}" y="${y}" text-anchor="end" font-family="${FONT}" font-size="18" font-weight="650" fill="${INK}" style="font-variant-numeric:tabular-nums">${fmtPct(s.value, total)}</text>
    <text x="${W - 40}" y="${y + 20}" text-anchor="end" font-family="${FONT}" font-size="13" fill="${INK_MUTED}" style="font-variant-numeric:tabular-nums">${s.value} commits</text>`;
    })
    .join('\n');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(chart.title)}">
  <rect width="${W}" height="${H}" fill="${SURFACE}"/>
  <text x="40" y="56" font-family="${FONT}" font-size="27" font-weight="700" fill="${INK}">${esc(chart.title)}</text>
  <text x="40" y="84" font-family="${FONT}" font-size="15" fill="${INK_2}">幸運星幣城 Lucky Star Casino ・ ${esc(chart.note)} ・ 共 ${total} 筆</text>
  <line x1="40" y1="104" x2="${W - 40}" y2="104" stroke="#e1e0d9" stroke-width="1"/>
  <g>
${pieSlices(geo, cx, cy, r)}
${insideLabels(geo, total, cx, cy, r, 0.07, 24)}
  </g>
  <g>
${leaders}
${labelText}
  </g>
  <text x="${legendX}" y="180" font-family="${FONT}" font-size="12" font-weight="600" letter-spacing="1.4" fill="${INK_MUTED}">成員 ・ 角色 ・ 佔比</text>
  <line x1="${legendX}" y1="192" x2="${W - 40}" y2="192" stroke="#e1e0d9" stroke-width="1"/>
${legend}
  <text x="40" y="${H - 26}" font-family="${FONT}" font-size="12" fill="${INK_MUTED}">資料來源：git log --no-merges ${esc(REF)}（經 .mailmap 收斂多組帳號身分）</text>
</svg>
`;
}

/** 小圖：圓餅 + 圖例清單（切片太小時外標會疊字，數字改放圖例）。 */
function smallSvg(chart, series) {
  const W = 440;
  const H = 326;
  const cx = 128;
  const cy = 210;
  const r = 92;
  const total = series.reduce((n, s) => n + s.value, 0);
  const geo = sliceGeometry(series, total);

  const legendX = 252;
  const legend = geo
    .map((s, i) => {
      const y = 148 + i * 40;
      return `    <rect x="${legendX}" y="${y - 10}" width="12" height="12" rx="3" fill="${s.color}"/>
    <text x="${legendX + 20}" y="${y}" font-family="${FONT}" font-size="14" font-weight="600" fill="${INK}">${esc(s.name)}</text>
    <text x="${legendX + 20}" y="${y + 17}" font-family="${FONT}" font-size="12.5" fill="${INK_2}" style="font-variant-numeric:tabular-nums">${fmtPct(s.value, total)}　${s.value} commits</text>`;
    })
    .join('\n');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(chart.title)}">
  <rect width="${W}" height="${H}" fill="${SURFACE}"/>
  <text x="28" y="46" font-family="${FONT}" font-size="20" font-weight="700" fill="${INK}">${esc(chart.title)}</text>
  <text x="28" y="70" font-family="${FONT}" font-size="12.5" fill="${INK_MUTED}">${esc(chart.note)}</text>
  <text x="28" y="90" font-family="${FONT}" font-size="12.5" fill="${INK_MUTED}" style="font-variant-numeric:tabular-nums">共 ${total} 筆 commit</text>
  <line x1="28" y1="106" x2="${W - 28}" y2="106" stroke="#e1e0d9" stroke-width="1"/>
  <g>
${pieSlices(geo, cx, cy, r)}
${insideLabels(geo, total, cx, cy, r, 0.12, 15)}
  </g>
${legend}
</svg>
`;
}

/** 說明頁：把 SVG 內嵌進來（發佈成 Artifact 後不能引用外部檔）。 */
function pageHtml(results, today) {
  const hero = results.find((r) => r.chart.id === 'overall');
  const facets = results.filter((r) => r.chart.id !== 'overall');
  const strip = (svg) => svg.replace(/^<\?xml[^>]*>\s*/, '').replace(/ width="\d+" height="\d+"/, ' class="sheet-svg"');

  const facetCards = facets
    .map(
      (r) => `      <figure class="sheet sheet--facet">
        ${strip(r.svg)}
        <figcaption>pie-${r.chart.id}.svg</figcaption>
      </figure>`
    )
    .join('\n');

  const tableRows = PEOPLE.map((p) => {
    const cells = results
      .map((r) => {
        const s = r.series.find((x) => x.name === p.name);
        const v = s ? s.value : 0;
        return `<td><span class="n">${v}</span><span class="p">${fmtPct(v, r.total)}</span></td>`;
      })
      .join('');
    return `          <tr><th scope="row"><span class="sw" style="background:${p.color}"></span>${esc(p.name)}<em>${esc(p.role)}</em></th>${cells}</tr>`;
  }).join('\n');

  const tableHead = results.map((r) => `<th scope="col">${esc(r.chart.title)}<em>n=${r.total}</em></th>`).join('');

  return `<title>幸運星幣城 — 團隊 commit 貢獻度</title>
<style>
  :root {
    color-scheme: light;
    --page: #f4f4f0;
    --card: #ffffff;
    --ink: #16181c;
    --ink-2: #4b5058;
    --muted: #85899180;
    --muted-solid: #7e838b;
    --rule: #e2e2da;
    --accent: #2a78d6;
    --sheet-ring: rgba(20, 22, 26, 0.12);
    --sheet-shadow: 0 1px 2px rgba(20, 22, 26, .06), 0 8px 24px -12px rgba(20, 22, 26, .18);
    --code-bg: #edeee9;
  }
  @media (prefers-color-scheme: dark) {
    :root:where(:not([data-theme="light"])) {
      color-scheme: dark;
      --page: #0f1012;
      --card: #17181b;
      --ink: #f2f3f5;
      --ink-2: #b3b8c0;
      --muted-solid: #868b93;
      --rule: #2a2c31;
      --accent: #6da7ec;
      --sheet-ring: rgba(255, 255, 255, 0.14);
      --sheet-shadow: 0 1px 2px rgba(0, 0, 0, .5), 0 10px 30px -14px rgba(0, 0, 0, .8);
      --code-bg: #202226;
    }
  }
  :root[data-theme="dark"] {
    color-scheme: dark;
    --page: #0f1012; --card: #17181b; --ink: #f2f3f5; --ink-2: #b3b8c0;
    --muted-solid: #868b93; --rule: #2a2c31; --accent: #6da7ec;
    --sheet-ring: rgba(255,255,255,.14);
    --sheet-shadow: 0 1px 2px rgba(0,0,0,.5), 0 10px 30px -14px rgba(0,0,0,.8);
    --code-bg: #202226;
  }

  body {
    margin: 0;
    background: var(--page);
    color: var(--ink);
    font-family: ${FONT};
    font-size: 16px;
    line-height: 1.72;
    -webkit-font-smoothing: antialiased;
  }
  .wrap { max-width: 1080px; margin: 0 auto; padding: 56px 24px 96px; display: flex; flex-direction: column; gap: 56px; }

  header { display: flex; flex-direction: column; gap: 14px; }
  .eyebrow { font-size: 12px; font-weight: 700; letter-spacing: .16em; text-transform: uppercase; color: var(--muted-solid); }
  h1 { margin: 0; font-size: clamp(30px, 4.4vw, 44px); line-height: 1.15; font-weight: 800; letter-spacing: -.022em; text-wrap: balance; }
  .lede { margin: 0; max-width: 62ch; font-size: 17px; color: var(--ink-2); }
  .meta { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 4px; }
  .chip { font-size: 13px; padding: 4px 11px; border: 1px solid var(--rule); border-radius: 999px; color: var(--ink-2); background: var(--card); font-variant-numeric: tabular-nums; }
  .chip b { color: var(--ink); font-weight: 650; }

  section { display: flex; flex-direction: column; gap: 20px; }
  h2 { margin: 0; font-size: 21px; font-weight: 700; letter-spacing: -.01em; padding-bottom: 10px; border-bottom: 1px solid var(--rule); }
  h2 span { color: var(--accent); font-variant-numeric: tabular-nums; font-weight: 700; margin-right: 10px; }
  h3 { margin: 0 0 2px; font-size: 16px; font-weight: 700; }
  p { margin: 0; max-width: 68ch; color: var(--ink-2); }
  p strong, li strong { color: var(--ink); font-weight: 650; }

  /* 圖卡固定亮底：它們就是要貼進投影片的素材，跟著頁面翻黑會跟 PPT 對不上 */
  .sheet {
    margin: 0; background: #fcfcfb; border-radius: 10px; padding: 8px 8px 0;
    box-shadow: var(--sheet-shadow); outline: 1px solid var(--sheet-ring); outline-offset: -1px;
    overflow-x: auto;
  }
  .sheet-svg { display: block; width: 100%; height: auto; }
  .sheet figcaption {
    padding: 9px 6px 11px; font-size: 12px; color: #898781;
    font-family: ui-monospace, "Cascadia Mono", Consolas, monospace;
  }
  .facets { display: grid; grid-template-columns: repeat(auto-fit, minmax(310px, 1fr)); gap: 20px; }

  .tablewrap { overflow-x: auto; background: var(--card); border: 1px solid var(--rule); border-radius: 10px; }
  table { border-collapse: collapse; width: 100%; min-width: 720px; font-variant-numeric: tabular-nums; }
  th, td { text-align: right; padding: 12px 16px; border-bottom: 1px solid var(--rule); white-space: nowrap; }
  tr:last-child th, tr:last-child td { border-bottom: 0; }
  thead th { font-size: 12.5px; font-weight: 650; color: var(--ink-2); vertical-align: bottom; line-height: 1.35; }
  thead th em { display: block; font-style: normal; font-size: 11.5px; color: var(--muted-solid); font-weight: 500; }
  tbody th[scope="row"] { text-align: left; font-weight: 650; font-size: 15px; }
  tbody th em { font-style: normal; font-weight: 500; font-size: 12px; color: var(--muted-solid); margin-left: 8px; }
  .sw { display: inline-block; width: 11px; height: 11px; border-radius: 3px; margin-right: 9px; vertical-align: baseline; }
  td .n { font-size: 15px; font-weight: 650; color: var(--ink); }
  td .p { display: block; font-size: 12px; color: var(--muted-solid); }

  ol.steps { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 18px; counter-reset: s; }
  ol.steps > li { counter-increment: s; display: grid; grid-template-columns: 30px 1fr; gap: 16px; align-items: start; }
  ol.steps > li::before {
    content: counter(s); grid-row: span 2; font-size: 13px; font-weight: 700; color: var(--accent);
    border: 1px solid var(--rule); border-radius: 50%; width: 30px; height: 30px;
    display: grid; place-items: center; background: var(--card); font-variant-numeric: tabular-nums;
  }
  ol.steps p { margin-top: 3px; font-size: 15px; }
  ul.plain { margin: 0; padding-left: 22px; display: flex; flex-direction: column; gap: 10px; color: var(--ink-2); font-size: 15px; max-width: 68ch; }
  code, pre { font-family: ui-monospace, "Cascadia Mono", Consolas, monospace; }
  code { background: var(--code-bg); padding: 2px 6px; border-radius: 5px; font-size: .875em; color: var(--ink); }
  pre { margin: 0; background: var(--code-bg); border: 1px solid var(--rule); border-radius: 8px; padding: 14px 16px; overflow-x: auto; font-size: 13px; line-height: 1.7; color: var(--ink); }
  pre code { background: none; padding: 0; }

  .callout { border-left: 3px solid var(--accent); padding: 2px 0 2px 18px; display: flex; flex-direction: column; gap: 8px; }
  footer { border-top: 1px solid var(--rule); padding-top: 18px; font-size: 13px; color: var(--muted-solid); }
</style>

<div class="wrap">
  <header>
    <div class="eyebrow">幸運星幣城 Lucky Star Casino</div>
    <h1>團隊 commit 貢獻度</h1>
    <p class="lede">以 <code>develop</code> 分支的 git 提交紀錄為依據，統計四位成員的 commit 佔比。多組帳號身分（換機器、GitHub 網頁操作的 noreply 帳號、不同拼法）已用 <code>.mailmap</code> 收斂成同一人，不需要改寫歷史。</p>
    <div class="meta">
      <span class="chip">分支 <b>${esc(REF)}</b></span>
      <span class="chip">總計 <b>${hero.total}</b> 筆 commit</span>
      <span class="chip">不含 merge commit</span>
      <span class="chip">產生日期 <b>${today}</b></span>
    </div>
  </header>

  <section>
    <h2><span>01</span>整體貢獻佔比</h2>
    <figure class="sheet">
      ${strip(hero.svg)}
      <figcaption>pie-overall.svg</figcaption>
    </figure>
  </section>

  <section>
    <h2><span>02</span>分面向拆解</h2>
    <p>同一個人在每張圖都是同一個顏色（顏色跟人走、不跟名次走），所以四張圖可以並排看出「誰主要在哪一層出力」。每張圖的百分比各自以該面向的 commit 數為分母。</p>
    <div class="facets">
${facetCards}
    </div>
  </section>

  <section>
    <h2><span>03</span>完整數據</h2>
    <div class="tablewrap">
      <table>
        <thead><tr><th scope="col">成員</th>${tableHead}</tr></thead>
        <tbody>
${tableRows}
        </tbody>
      </table>
    </div>
    <p>面向之間會重疊：一筆同時改到 <code>backend/</code> 和 <code>docs/</code> 的 commit，兩張圖都會算到，所以四個面向加總大於總數。</p>
  </section>

  <section>
    <h2><span>04</span>這張圖是怎麼畫出來的</h2>
    <ol class="steps">
      <li><h3>先把身分收斂</h3><p>原始歷史裡有 8 組 name/email，直接跑 <code>git shortlog</code> 會把同一個人算成好幾位。專案根目錄的 <code>.mailmap</code> 把它們映射到同一個正式姓名，git 自己就會合併 —— <strong>不需要 rebase 改寫歷史</strong>（分支已共享，改寫會炸掉所有人的本機）。</p></li>
      <li><h3>取數：只數 commit，排除 merge</h3><p>merge commit 不含實際改動，算進去會讓負責合併的人虛胖。<code>--no-merges</code> 排掉。</p></li>
      <li><h3>選一個分支當分母</h3><p>用 <code>develop</code>（整合分支）。<code>main</code> 是 squash 過的，只剩 22 筆，拿來當分母會失真。</p></li>
      <li><h3>四個人的顏色先綁死</h3><p>顏色代表「人」不代表「名次」。若照排名上色，換一張圖名次一變顏色就跟著換，讀者會誤以為是不同人。</p></li>
      <li><h3>輸出成向量 SVG</h3><p>PPT 可以直接插入 SVG，投影放大不糊，插入後還能在 PPT 內按右鍵「轉換成圖形」改字改色。</p></li>
    </ol>
    <pre><code># 重新產圖（commit 增加後直接重跑，數字自動更新）
node tools/contribution/generate-contribution-charts.mjs

# 只想看數字不產圖
git log --no-merges --pretty=%aN develop | sort | uniq -c | sort -rn</code></pre>
  </section>

  <section>
    <h2><span>05</span>怎麼放進 PPT</h2>
    <ul class="plain">
      <li><strong>插入 → 圖片 → 此裝置</strong>，選 <code>docs/report/contribution/pie-*.svg</code>。PowerPoint 2016 以後原生支援 SVG。</li>
      <li>圖已經自帶標題、副標與資料來源，<strong>整張貼滿一頁投影片就是完整的一頁</strong>，不必再另外打字。若你的版型已有標題列，插入後裁掉上方標題區即可。</li>
      <li>要改字體或配色：在 PPT 裡對圖<strong>按右鍵 → 轉換成圖形</strong>，之後每個文字與色塊都能單獨編輯。</li>
      <li>四張分面圖尺寸一致（440×326），並排成 2×2 剛好是一頁。</li>
      <li>若簡報主題是深色底：這些圖是白底的，建議放在白色卡片上，不要直接透明疊在深色背景。</li>
    </ul>
  </section>

  <section>
    <h2><span>06</span>誠實的限制</h2>
    <div class="callout">
      <p><strong>commit 數不等於工作量。</strong>習慣小步提交的人數字天生比較高；把一整天的工作壓成一筆的人會被低估。這張圖適合呈現「參與的廣度與節奏」，不適合當作績效評分。</p>
      <p><strong>那為什麼不用「程式碼行數」？</strong>試算過了，用行數會更失真：本專案行數前兩名的差距，幾乎完全來自 <code>docs/performance/assets/</code> 底下約 3.5 萬行機器產生的壓測 CSV，以及 1.3 萬行 <code>package-lock.json</code>。那些不是人寫的程式碼。相較之下，commit 數至少每一筆都對應一次真實的「做完一件事並提交」。</p>
      <p>要更貼近實際分工，建議簡報時把這張圖跟 <strong>工作分配表（T-000～T-114）</strong> 並列：圖說明節奏，任務表說明範圍。</p>
    </div>
  </section>

  <footer>資料來源：<code>git log --no-merges ${esc(REF)}</code>，經 <code>.mailmap</code> 收斂帳號身分 ・ 由 <code>tools/contribution/generate-contribution-charts.mjs</code> 產生 ・ ${today}</footer>
</div>
`;
}

mkdirSync(OUT_DIR, { recursive: true });

const results = CHARTS.map((chart) => {
  const series = commitCounts(chart.paths);
  const total = series.reduce((n, s) => n + s.value, 0);
  const svg = chart.id === 'overall' ? heroSvg(chart, series) : smallSvg(chart, series);
  const file = resolve(OUT_DIR, `pie-${chart.id}.svg`);
  writeFileSync(file, svg, 'utf8');
  return { chart, series, total, svg, file };
});

writeFileSync(
  resolve(OUT_DIR, 'data.json'),
  `${JSON.stringify(
    {
      ref: REF,
      generatedAt: new Date().toISOString().slice(0, 10),
      charts: results.map((r) => ({
        id: r.chart.id,
        title: r.chart.title,
        total: r.total,
        series: r.series.map((s) => ({ name: s.name, value: s.value, pct: +((s.value / r.total) * 100).toFixed(1) })),
      })),
    },
    null,
    2
  )}\n`,
  'utf8'
);

writeFileSync(resolve(OUT_DIR, 'contribution-report.html'), pageHtml(results, new Date().toISOString().slice(0, 10)), 'utf8');

for (const r of results) {
  console.log(`${r.chart.id.padEnd(9)} n=${String(r.total).padStart(3)}  ${r.series.map((s) => `${s.name} ${s.value}(${fmtPct(s.value, r.total)})`).join('  ')}`);
}
console.log(`\n輸出：${OUT_DIR}`);
