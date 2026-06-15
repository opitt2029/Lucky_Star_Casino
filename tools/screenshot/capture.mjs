// 報告用截圖工具：以系統 Edge/Chrome 開啟前端（mock API 模式），逐頁注入
// 「紅框 + 編號標籤 + 箭頭」標註後輸出 PNG 到 docs/report/assets/。
import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

const BASE = 'http://localhost:5173'
const OUT = resolve(import.meta.dirname, '../../docs/report/assets')
mkdirSync(OUT, { recursive: true })

// ---- 頁面內執行的標註注入函式（序列化後丟進瀏覽器） ----
const injectFn = (annotations) => {
  const old = document.getElementById('__annot_layer')
  if (old) old.remove()
  const layer = document.createElement('div')
  layer.id = '__annot_layer'
  layer.style.cssText =
    'position:absolute;left:0;top:0;width:100%;height:0;z-index:2147483000;pointer-events:none;'
  document.body.appendChild(layer)

  const findTarget = (t) => {
    let el = null
    if (t.selector) {
      const els = [...document.querySelectorAll(t.selector)].filter((e) => {
        const r = e.getBoundingClientRect()
        return r.width > 0 && r.height > 0
      })
      el = els[t.nth || 0]
    } else if (t.text) {
      const tags = t.tags || 'button,a,h1,h2,h3,p,span,label,th,summary,div'
      const all = [...document.querySelectorAll(tags)]
      const matches = all
        .filter((e) => {
          const own = (e.textContent || '').trim()
          if (!own) return false
          const hit = t.exact ? own === t.text : own.includes(t.text)
          if (!hit) return false
          // 取「最深」含該文字的元素，避免框到整個容器
          return ![...e.children].some((c) => (c.textContent || '').includes(t.text))
        })
        .filter((e) => {
          const r = e.getBoundingClientRect()
          return r.width > 0 && r.height > 0
        })
      el = matches[t.nth || 0]
    }
    for (let i = 0; el && i < (t.up || 0); i++) el = el.parentElement
    return el
  }

  const placed = []
  annotations.forEach((a, idx) => {
    const el = findTarget(a)
    if (!el) {
      console.warn('[annot] 找不到目標:', JSON.stringify(a))
      return
    }
    const r = el.getBoundingClientRect()
    const x = r.left + window.scrollX
    const y = r.top + window.scrollY
    const num = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮'[idx] || `(${idx + 1})`

    // 紅框
    const box = document.createElement('div')
    box.style.cssText = `position:absolute;left:${x - 3}px;top:${y - 3}px;width:${r.width + 6}px;height:${r.height + 6}px;border:3px solid #ff2d55;border-radius:8px;box-shadow:0 0 0 2px rgba(255,45,85,.25);`
    layer.appendChild(box)

    // 標籤（預設放在框上方，太靠頂則放下方），並避免互相重疊
    const chip = document.createElement('div')
    chip.textContent = `${num} ${a.label}`
    const below = y < 46
    let chipTop = below ? y + r.height + 10 : y - 38
    let chipLeft = x
    for (const p of placed) {
      if (Math.abs(p.top - chipTop) < 30 && chipLeft < p.left + p.width + 8 && p.left < chipLeft + 260) {
        chipTop = below ? chipTop + 32 : chipTop - 32
      }
    }
    chip.style.cssText = `position:absolute;left:${chipLeft}px;top:${chipTop}px;background:#ff2d55;color:#fff;font:900 14px/1.4 system-ui,'Microsoft JhengHei',sans-serif;padding:4px 10px;border-radius:6px;white-space:nowrap;box-shadow:0 2px 8px rgba(0,0,0,.5);`
    layer.appendChild(chip)
    placed.push({ top: chipTop, left: chipLeft, width: chip.offsetWidth || 200 })

    // 箭頭（從標籤指向紅框）
    const arrow = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    const ax1 = chipLeft + 14
    const ay1 = below ? chipTop : chipTop + 26
    const ax2 = x + Math.min(28, r.width / 2)
    const ay2 = below ? y + r.height + 3 : y - 3
    const minX = Math.min(ax1, ax2) - 8
    const minY = Math.min(ay1, ay2) - 8
    arrow.setAttribute('style', `position:absolute;left:${minX}px;top:${minY}px;overflow:visible;`)
    arrow.setAttribute('width', Math.abs(ax2 - ax1) + 16)
    arrow.setAttribute('height', Math.abs(ay2 - ay1) + 16)
    arrow.innerHTML = `<defs><marker id="ah${idx}" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 z" fill="#ff2d55"/></marker></defs><line x1="${ax1 - minX}" y1="${ay1 - minY}" x2="${ax2 - minX}" y2="${ay2 - minY}" stroke="#ff2d55" stroke-width="3" marker-end="url(#ah${idx})"/>`
    layer.appendChild(arrow)
  })
}

const removeFn = () => {
  const old = document.getElementById('__annot_layer')
  if (old) old.remove()
}

async function shoot(page, name, annotations, { fullPage = true } = {}) {
  if (annotations?.length) await page.evaluate(injectFn, annotations)
  await page.waitForTimeout(350)
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage })
  await page.evaluate(removeFn)
  console.log('✓', name)
}

async function autoScroll(page) {
  await page.evaluate(async () => {
    const h = document.body.scrollHeight
    for (let yy = 0; yy < h; yy += 400) {
      window.scrollTo(0, yy)
      await new Promise((r) => setTimeout(r, 90))
    }
    window.scrollTo(0, 0)
    await new Promise((r) => setTimeout(r, 350))
  })
}

async function goWait(page, path) {
  await page.goto(BASE + path, { waitUntil: 'networkidle' })
  await page.waitForTimeout(700)
}

const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })

// ---------- 1. 首頁（未登入） ----------
// 注意：首頁是「內部捲動容器」(.scroll-shell)，區塊透明度由容器 scrollTop 推導
// （--section-reveal），所以不能整頁截圖，要逐區塊捲到定位後各截一張。
const scrollHomeTo = async (id) => {
  await page.evaluate((sectionId) => {
    const shell = document.querySelector('.scroll-shell')
    const target = document.getElementById(sectionId)
    shell.scrollTo({ top: sectionId === 'intro' ? 0 : target.offsetTop - 40, behavior: 'instant' })
    shell.dispatchEvent(new Event('scroll'))
  }, id)
  await page.waitForTimeout(900)
}

await goWait(page, '/')
await scrollHomeTo('intro')
await shoot(page, 'home', [
  { selector: 'header nav', label: '頂部導覽：介紹/遊戲/會員/商城（錨點捲動）' },
  { text: '會員登入', label: '未登入 → /member' },
  { selector: '#intro h1, #intro h2', label: '主視覺標題與平台介紹' },
  { selector: '#intro a', nth: 0, label: '主要 CTA → 遊戲大全/登入' },
  { selector: '#intro a', nth: 1, label: '次要 CTA → 瀏覽遊戲介紹' },
], { fullPage: false })

await scrollHomeTo('games')
await shoot(page, 'home-games', [
  { selector: '#games .scroll-copy h2, #games h2', label: '遊戲介紹區標題' },
  { selector: '#games a', nth: 0, label: '遊戲卡片 → /game/slot（未登入導向登入頁）' },
  { selector: '#games a', nth: 1, label: '遊戲卡片 → /game/baccarat' },
], { fullPage: false })

await scrollHomeTo('member')
await shoot(page, 'home-member', [
  { selector: '#member h2', label: '會員區標題' },
  { selector: '#member a', nth: 0, label: '→ /member 登入或註冊' },
  { selector: '#member a', nth: 1, label: '→ /profile 會員中心' },
], { fullPage: false })

await scrollHomeTo('shop')
await shoot(page, 'home-shop', [
  { selector: '#shop h2', label: '商城區標題' },
  { selector: '#shop a', nth: 0, label: '→ /diamond 鑽石錢包' },
  { selector: '#shop a', nth: 1, label: '→ /shop 禮品商城' },
], { fullPage: false })

// ---------- 2. 登入頁 ----------
await goWait(page, '/member?mode=login')
await shoot(page, 'member-login', [
  { text: '登入', tags: 'button', nth: 0, label: '分頁切換：登入', exact: true },
  { text: '註冊', tags: 'button', nth: 0, label: '分頁切換：註冊', exact: true },
  { selector: 'form input[type="text"]', label: '帳號（預填測試帳號 test）' },
  { selector: 'form input[type="password"]', label: '密碼' },
  { text: 'LINE', tags: 'button,span', label: '社群登入（尚未實裝，僅提示）' },
  { selector: 'form button[type="submit"]', label: '送出 → POST /api/v1/auth/login' },
], { fullPage: false })

// ---------- 3. 註冊頁 ----------
await page.click('button:has-text("註冊")')
await page.waitForTimeout(600)
await shoot(page, 'member-register', [
  { selector: 'form input[type="text"]', nth: 0, label: '帳號（至少 3 碼）' },
  { selector: 'form input[type="text"]', nth: 1, label: '暱稱（至少 2 碼）' },
  { selector: 'form input[type="email"]', label: 'Email' },
  { selector: 'form input[type="password"]', label: '密碼（8 碼以上，含英文+數字）' },
  { selector: 'form input[type="date"]', label: '出生日期（滿 18 歲驗證）' },
  { selector: 'form input[type="checkbox"]', label: '年齡同意勾選', up: 1 },
  { selector: 'form button[type="submit"]', label: '送出 → POST /api/v1/auth/register' },
])

// ---------- 4. 登入並處理簽到彈窗 ----------
await page.click('button:has-text("登入")')
await page.waitForTimeout(400)
await page.click('form button[type="submit"]')
await page.waitForURL('**/games', { timeout: 15000 })
await page.waitForTimeout(1200)

const modal = page.locator('[role="dialog"]')
if (await modal.isVisible().catch(() => false)) {
  await shoot(page, 'checkin-modal', [
    { text: '簽到獎勵', tags: 'h2', label: '每日自動彈出的簽到視窗' },
    { text: '今日可領', label: '今日獎勵試算', up: 1 },
    { text: '確認簽到領', tags: 'button', label: '簽到 → POST /api/v1/wallet/daily-checkin' },
    { selector: '[role="dialog"] .grid-cols-7', label: '本月簽到日曆' },
    { text: '連續 7 天', label: '連續簽到里程碑加碼', up: 1 },
  ], { fullPage: false })
  await page.click('[role="dialog"] >> button:has-text("關閉"), [role="dialog"] >> button:has-text("稍後")').catch(() => {})
  await page.waitForTimeout(500)
}

// ---------- 5. 遊戲大廳（含共用頂欄標註） ----------
await goWait(page, '/games')
await shoot(page, 'lobby', [
  { selector: 'header h1', label: '品牌標題' },
  { selector: 'header nav', label: '主導覽列（7 個頁面）' },
  { text: 'Diamond', tags: 'span', label: '鑽石餘額', up: 1 },
  { text: 'Star Coin', tags: 'span', label: '星幣餘額', up: 1 },
  { selector: 'button[aria-label="通知中心"]', label: '通知中心' },
  { text: '登出', tags: 'button', label: '登出 → POST /api/v1/auth/logout', exact: true },
  { text: '前往禮品商城', tags: 'button,a', label: '→ /shop' },
  { text: '鑽石兌換星幣', tags: 'button,a', label: '→ /diamond' },
  { text: '進入遊戲', tags: 'span,button,a', nth: 0, label: '遊戲卡片 → /game/slot 等', up: 2 },
])

// ---------- 6. 老虎機 ----------
await goWait(page, '/game/slot')
await shoot(page, 'slot', [
  { text: 'SPIN', tags: 'button,span', label: '開轉 → POST /api/v1/game/slot/spin', up: 0 },
  { text: '下注面板', label: '下注金額 100/500/1000/MAX', up: 1 },
  { text: '可用星幣', label: '即時餘額', up: 1 },
  { text: '星幣老虎機規則', label: '規則與派彩表（2x/3x/5x/8x）', up: 1 },
  { text: '中線命中', label: '本局狀態指示', up: 1 },
])

// ---------- 7. 百家樂 ----------
await goWait(page, '/game/baccarat')
await shoot(page, 'baccarat', [
  { text: '閒家', label: 'Player 手牌與點數', up: 2 },
  { text: '莊家', label: 'Banker 手牌與點數', up: 2 },
  { text: '下注區', label: '選 Player(1x)/Banker(0.95x)/Tie(8x)', up: 1 },
  { selector: 'input[type="number"]', label: '下注金額輸入' },
  { text: '開始發牌', tags: 'button', label: '發牌結算（目前為前端本機計算）' },
  { text: '本局結算', label: '勝方/派彩結果', up: 1 },
])

// ---------- 8. 鑽石錢包 ----------
await goWait(page, '/diamond')
await shoot(page, 'diamond', [
  { text: '目前鑽石', nth: 0, label: '鑽石餘額', up: 1 },
  { text: '重新同步', tags: 'button', label: 'GET /api/v1/wallet/diamond/balance' },
  { text: '序號兌換鑽石', tags: 'h2,h3,p', nth: 0, label: '輸入卡片序號兌換', up: 1 },
  { text: '兌換鑽石', tags: 'button', label: 'POST /api/v1/wallet/diamond/redeem' },
  { text: '鑽石兌換星幣', tags: 'h2,h3,p', nth: 0, label: '1 鑽石 = 20 星幣', up: 1 },
  { text: '兌換星幣', tags: 'button', label: 'POST /api/v1/wallet/diamond/exchange' },
])

// ---------- 9. 禮品商城 ----------
await goWait(page, '/shop')
await shoot(page, 'shop', [
  { text: '禮品商城', tags: 'h1,h2', label: '用星幣兌換禮品（目前為前端展示）' },
  { text: '可用星幣', nth: 0, label: '星幣餘額', up: 1 },
  { text: '商城總值', label: '禮品總數統計', up: 1 },
  { text: '前往鑽石錢包', tags: 'button,a', label: '→ /diamond' },
  { text: '兌換', tags: 'button', nth: 0, label: '兌換禮品（扣星幣，僅前端狀態）', exact: true },
])

// ---------- 10. 排行榜 ----------
await goWait(page, '/rank')
await shoot(page, 'rank', [
  { text: '全服 TOP100', tags: 'button', label: '全服排行（GET /api/v1/rank/global）' },
  { text: '好友榜', tags: 'button', label: '好友排行（GET /api/v1/rank/friends）' },
  { selector: 'input[type="search"], input[placeholder*="搜尋"]', label: '搜尋名次' },
  { text: '我的名次', label: '個人名次', up: 1 },
  { text: '顯示更多', tags: 'button', label: '20 筆 → 100 筆' },
])

// ---------- 11. 會員中心 ----------
await goWait(page, '/profile')
await shoot(page, 'profile', [
  { text: '上傳頭像', label: '上傳圖片（<300KB，JPG/PNG/GIF/WebP）' },
  { text: '儲存設定', tags: 'button', label: 'PUT /api/v1/player/profile' },
  { text: '可用星幣', nth: 0, label: '餘額資訊', up: 1 },
  { text: 'Check-in', tags: 'p,span', label: '簽到面板（連續天數/進度）', up: 1 },
  { text: '第三方帳戶綁定', label: 'LINE/Google/Apple 綁定（未實裝）', up: 1 },
])

// ---------- 12. 交易紀錄 ----------
await goWait(page, '/transactions')
await shoot(page, 'transactions', [
  { text: '更新紀錄', tags: 'button', label: '重新查詢交易' },
  { selector: 'select', label: '類型篩選：下注/派彩/簽到/任務/贈送' },
  { selector: 'input[type="date"]', nth: 0, label: '起始日期' },
  { selector: 'input[type="date"]', nth: 1, label: '結束日期' },
  { selector: 'table', label: '交易明細（ID/類型/金額/狀態/時間）' },
  { text: '下一頁', tags: 'button', label: '分頁（每頁 8 筆）' },
])

// ---------- 13. 每日簽到頁 ----------
await goWait(page, '/check-in')
await shoot(page, 'checkin-page', [
  { text: '每日簽到', tags: 'h1,h2', label: '簽到主頁' },
  { text: '立即簽到', tags: 'button', label: 'POST /api/v1/wallet/daily-checkin' },
  { text: '目前星幣', label: '餘額', up: 1 },
  { text: '連續簽到', label: '連續天數', up: 1 },
])

await browser.close()
console.log('全部截圖完成 →', OUT)
