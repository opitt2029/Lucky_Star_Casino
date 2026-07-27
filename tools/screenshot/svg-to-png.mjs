/**
 * 把 SVG 轉成高解析 PNG（給 pptx 插圖用）。
 *
 * PowerPoint 對 SVG 的支援看版本臉色，插 PNG 最保險；但 PNG 是點陣圖，
 * 解析度不夠投影出來就糊，所以這裡用 deviceScaleFactor 放大到 3 倍
 * （1280×720 → 3840×2160，13.33in 投影片上約 288 DPI）。
 *
 * 用系統已安裝的 Edge/Chrome（channel: msedge），不另外下載瀏覽器。
 *
 * 用法：
 *   node tools/screenshot/svg-to-png.mjs <in.svg> <out.png> [width] [height] [scale]
 */
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const [, , inSvg, outPng, w = '1280', h = '720', scale = '3'] = process.argv;
if (!inSvg || !outPng) {
  console.error('usage: node svg-to-png.mjs <in.svg> <out.png> [w] [h] [scale]');
  process.exit(1);
}

const width = Number(w);
const height = Number(h);

// SVG 內容直接內嵌，不要用 <img src="file://...">：
// setContent() 產生的頁面 origin 是 about:blank，載不了 file:// 資源會一直空白。
const svg = readFileSync(path.resolve(inSvg), 'utf8');
const html = `<!doctype html><meta charset="utf-8">
<style>html,body{margin:0;padding:0}svg{display:block;width:${width}px;height:${height}px}</style>
${svg}`;

let browser;
for (const channel of ['msedge', 'chrome']) {
  try {
    browser = await chromium.launch({ channel, headless: true });
    break;
  } catch { /* 換下一個 channel 再試 */ }
}
if (!browser) {
  console.error('找不到系統的 Edge 或 Chrome');
  process.exit(1);
}

const page = await browser.newPage({
  viewport: { width, height },
  deviceScaleFactor: Number(scale),
});
await page.setContent(html);
// 等字型載入完成再截圖，否則中文可能還在 fallback 字型上
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: path.resolve(outPng), type: 'png' });
await browser.close();
console.log(`[ok] ${outPng}  ${width * scale}x${height * scale}`);
