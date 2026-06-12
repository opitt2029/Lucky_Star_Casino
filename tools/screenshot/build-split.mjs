// 由總體檢報告（單一來源）拆出兩冊獨立文件：
//   A.《開發與流程報告》＝ 概覽 + 架構 + Git/CI + 業務流程 + 除錯報告 + 附錄
//   B.《前端功能導覽》　＝ 第 5 章逐頁標註截圖
// 修改內容請改總體檢報告 .md，再重跑本腳本與 build-html.mjs 同步。
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const dir = resolve(import.meta.dirname, '../../docs/report')
const src = readFileSync(`${dir}/Lucky-Star-Casino-總體檢報告.md`, 'utf8')

const S5 = '## 5. 前端頁面功能導覽（標註截圖）'
const S6 = '## 6. 除錯報告（Debugging）'
const i5 = src.indexOf(S5)
const i6 = src.indexOf(S6)
if (i5 < 0 || i6 < 0) throw new Error('找不到第 5 / 6 章標記，請確認總報告結構')

const before5 = src.slice(0, i5)
const sec5 = src.slice(i5, i6).replace(/\n---\s*$/s, '\n')
const from6 = src.slice(i6)

// ---------- A. 開發與流程報告 ----------
let partA = before5 + `${S5.replace('## ', '## ')}

> 本章獨立成冊：請見同資料夾《**Lucky-Star-Casino-前端功能導覽**》（.md / .html）。

---

` + from6
partA = partA
  .replace('# 幸運星幣城（Lucky Star Casino）— 系統總體檢報告',
           '# 幸運星幣城（Lucky Star Casino）— 開發與流程報告')
  .replace(/^> 產出日期.*$/m,
           '> 產出日期：2026-06-12 ｜ 範圍：專案概覽、系統架構、開發/業務工作流程（Mermaid）、除錯報告。前端逐頁功能導覽另見《前端功能導覽》分冊。')
  .replace(/^> 同資料夾的 `Lucky-Star-Casino-總體檢報告\.html`.*$/m,
           '> 同名 `.html` 用瀏覽器開啟 → 列印 → 另存 PDF。')
  .replace(/^5\. \[前端頁面功能導覽.*$/m,
           '5. 前端頁面功能導覽 →（獨立分冊《前端功能導覽》）')
  .replace(/^   - 4\.6 .*$\n(?=5\.)/m, (m) => m) // no-op，保持結構
writeFileSync(`${dir}/Lucky-Star-Casino-開發與流程報告.md`, partA)

// ---------- B. 前端功能導覽 ----------
const toc = [...sec5.matchAll(/^### (5\.\d+ .+)$/gm)]
  .map(([, t]) => {
    const anchor = t.trim().toLowerCase().replace(/[^\p{L}\p{N} -]/gu, '').replace(/ /g, '-')
    return `- [${t}](#${anchor})`
  })
  .join('\n')

const partB = `# 幸運星幣城（Lucky Star Casino）— 前端功能導覽

> 產出日期：2026-06-12 ｜ 內容：13 個頁面的實際介面標註截圖（紅框 + 編號箭頭）與功能/API 對照。
> 章節編號沿用《系統總體檢報告》第 5 章。系統架構與工作流程請見《開發與流程報告》分冊。
> 同名 \`.html\` 用瀏覽器開啟 → 列印 → 另存 PDF。

---

## 目錄

${toc}

---

${sec5}`
writeFileSync(`${dir}/Lucky-Star-Casino-前端功能導覽.md`, partB)
console.log('✓ 已拆出：開發與流程報告.md、前端功能導覽.md')
