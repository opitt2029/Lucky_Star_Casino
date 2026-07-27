#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""產生「董事長版」ER 圖（3 張 SVG）。

用途
----
`er-postgres.svg` / `er-mysql.svg` / `er-cross-db-cqrs.svg` 是給工程師看的
Mermaid ER 圖（有 PK/FK/型別）。本腳本產生對應的**經營層版本**：
去掉技術欄位，只保留「這份資料是什麼、為什麼對經營重要」。

執行
----
    python docs/assets/er/generate-er-executive.py

輸出（覆寫，淺色 / 深色各一組共 6 張）
--------------------------------------
    docs/assets/er/er-postgres-董事長版.svg        （白底，適合列印 / 淺色文件）
    docs/assets/er/er-mysql-董事長版.svg
    docs/assets/er/er-cross-db-cqrs-董事長版.svg
    docs/assets/er/er-postgres-董事長版-深色.svg   （黑底，適合深色簡報 / 螢幕）
    docs/assets/er/er-mysql-董事長版-深色.svg
    docs/assets/er/er-cross-db-cqrs-董事長版-深色.svg

資料來源：同資料夾的 `注解-*.md`（schema 有變動時，先更新注解再改本檔的資料區）。
"""

from pathlib import Path

# ---------------------------------------------------------------------------
# 1. 共用樣式常數
# ---------------------------------------------------------------------------

# 字型堆疊內層用單引號，外層 SVG 屬性才能安全地用雙引號包起來
FONT = ("'Microsoft JhengHei','Microsoft YaHei','PingFang TC','Noto Sans TC',"
        "'Heiti TC','Segoe UI Emoji',-apple-system,sans-serif")
MONO = "'Consolas','Menlo','Courier New',monospace"

# 兩套配色。深色版不是把淺色反相就好——暗底上的深色（如 #B45309）幾乎看不見，
# 所以強調色整組換成明度更高的版本，分區底色則換成「帶色調的暗面」。
PALETTES = {
    "light": {
        "INK": "#0F172A",        # 主要文字（近黑）
        "INK_SUB": "#475569",    # 次要文字（灰）
        "INK_MUTE": "#94A3B8",   # 技術表名（淺灰）
        "CANVAS": "#FFFFFF",     # 整張圖的底
        "PAPER": "#F8FAFC",      # 關聯總覽帶的底
        "CARD_BG": "#FFFFFF",    # 資料卡的底
        "CARD_BORDER": "#E2E8F0",
        "CALLOUT_BG": "#0F172A",  # 頁首「一句話」框
        "CALLOUT_FG": "#F1F5F9",
        "ARROW": "#334155",      # 實線箭頭
        "ARROW_DIM": "#94A3B8",  # 虛線箭頭
        "SHADOW": ("#0F172A", "0.10"),
        # 業務分區配色：(強調色, 分區底色)
        "THEME": {
            "gold":    ("#B45309", "#FEF3C7"),
            "violet":  ("#6D28D9", "#EDE9FE"),
            "emerald": ("#047857", "#D1FAE5"),
            "sky":     ("#0369A1", "#E0F2FE"),
            "rose":    ("#BE123C", "#FFE4E6"),
            "indigo":  ("#4338CA", "#E0E7FF"),
            "teal":    ("#0F766E", "#CCFBF1"),
            "slate":   ("#475569", "#E2E8F0"),
        },
    },
    "dark": {
        "INK": "#F1F5F9",
        "INK_SUB": "#A9B6C8",
        # 比淺色版的 #94A3B8 再亮一點：暗底上的小字（11px 的技術表名）
        # 若照抄淺色的灰度，投影時幾乎看不見
        "INK_MUTE": "#8496AE",
        "CANVAS": "#0B1120",
        "PAPER": "#131C2C",
        "CARD_BG": "#1B2436",
        "CARD_BORDER": "#2E3A50",
        "CALLOUT_BG": "#1B2436",
        "CALLOUT_FG": "#F1F5F9",
        "ARROW": "#CBD5E1",
        "ARROW_DIM": "#7C8BA1",
        "SHADOW": ("#000000", "0.45"),
        "THEME": {
            "gold":    ("#FBBF24", "#2A2008"),
            "violet":  ("#A78BFA", "#1E1638"),
            "emerald": ("#34D399", "#08281E"),
            "sky":     ("#38BDF8", "#082436"),
            "rose":    ("#FB7185", "#2C0F1B"),
            "indigo":  ("#8B95FA", "#181B3C"),
            "teal":    ("#2DD4BF", "#072B27"),
            "slate":   ("#94A3B8", "#18202E"),
        },
    },
}


def use_theme(mode):
    """切換配色：把該套色票攤平成模組層變數。

    這樣下面每個繪圖函式都不必多接一個 palette 參數。本檔是單執行緒、
    一次性執行的腳本，用全域變數安全且讀起來最短。
    """
    global INK, INK_SUB, INK_MUTE, CANVAS, PAPER, CARD_BG, CARD_BORDER
    global CALLOUT_BG, CALLOUT_FG, ARROW, ARROW_DIM, SHADOW, THEME
    p = PALETTES[mode]
    INK, INK_SUB, INK_MUTE = p["INK"], p["INK_SUB"], p["INK_MUTE"]
    CANVAS, PAPER = p["CANVAS"], p["PAPER"]
    CARD_BG, CARD_BORDER = p["CARD_BG"], p["CARD_BORDER"]
    CALLOUT_BG, CALLOUT_FG = p["CALLOUT_BG"], p["CALLOUT_FG"]
    ARROW, ARROW_DIM = p["ARROW"], p["ARROW_DIM"]
    SHADOW, THEME = p["SHADOW"], p["THEME"]


use_theme("light")

# 版面尺寸
W = 1680           # 畫布寬
MARGIN = 40
COL_GAP = 32
COL_W = (W - MARGIN * 2 - COL_GAP) // 2   # 單欄寬 = 784
CARD_H = 96
CARD_GAP = 12
GROUP_HEAD = 72    # 分區標題列高
GROUP_PAD = 20     # 分區底部留白
GROUP_GAP = 28     # 分區之間垂直間距


# ---------------------------------------------------------------------------
# 2. 低階繪圖工具
# ---------------------------------------------------------------------------

def esc(s):
    """XML escape。SVG 是 XML，& < > 一定要跳脫，否則整張圖打不開。"""
    return (str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;"))


def est_width(s, size):
    """粗估字串像素寬度：中日韓字元約等於字級，半形字元約 0.55 倍。

    只用來算「膠囊圖示」要多寬，不需要精準，估錯一點點不影響閱讀。
    """
    w = 0.0
    for ch in s:
        w += size if ord(ch) > 0x2E7F else size * 0.55
    return w


def rect(x, y, w, h, fill, rx=12, stroke=None, sw=1, extra=""):
    st = f' stroke="{stroke}" stroke-width="{sw}"' if stroke else ""
    return (f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{rx}" '
            f'fill="{fill}"{st}{extra}/>')


def txt(x, y, s, size=14, fill=None, weight="normal", anchor="start",
        family=None, opacity=None):
    # 預設色必須在呼叫當下才取 INK，不能寫成參數預設值——
    # 參數預設值在函式定義時就固定了，use_theme() 之後換不掉。
    fill = fill or INK
    fam = family or FONT
    op = f' opacity="{opacity}"' if opacity is not None else ""
    return (f'<text x="{x}" y="{y}" font-family="{fam}" font-size="{size}" '
            f'fill="{fill}" font-weight="{weight}" text-anchor="{anchor}"{op}>'
            f'{esc(s)}</text>')


def line(x1, y1, x2, y2, stroke, sw=2, dash=None, marker=None):
    d = f' stroke-dasharray="{dash}"' if dash else ""
    m = f' marker-end="url(#{marker})"' if marker else ""
    return (f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="{stroke}" '
            f'stroke-width="{sw}" stroke-linecap="round"{d}{m}/>')


def defs():
    """箭頭符號 + 卡片陰影。實線箭頭＝實際資料流，虛線箭頭＝邏輯對應。"""
    heads = []
    for name, color in [("arrowSolid", ARROW), ("arrowDash", ARROW_DIM),
                        ("arrowGold", THEME["gold"][0])]:
        heads.append(
            f'<marker id="{name}" viewBox="0 0 10 10" refX="9" refY="5" '
            f'markerWidth="7" markerHeight="7" orient="auto-start-reverse">'
            f'<path d="M 0 0 L 10 5 L 0 10 z" fill="{color}"/></marker>')
    sh_color, sh_op = SHADOW
    return ("<defs>"
            + "".join(heads)
            + '<filter id="sh" x="-25%" y="-25%" width="150%" height="150%">'
              f'<feDropShadow dx="0" dy="1.5" stdDeviation="2.5" '
              f'flood-color="{sh_color}" flood-opacity="{sh_op}"/></filter>'
            + "</defs>")


# ---------------------------------------------------------------------------
# 3. 中階元件：卡片 / 分區 / 頁首 / 關聯總覽 / 圖例
# ---------------------------------------------------------------------------

def card(x, y, w, item, accent):
    """一張「資料卡」＝一張資料表的經營層說明。

    item = (中文名, 白話用途, 為什麼重要, 技術表名)
    """
    name, use, why, table = item
    p = [rect(x, y, w, CARD_H, CARD_BG, rx=10, stroke=CARD_BORDER,
              extra=' filter="url(#sh)"'),
         # 左側色條：一眼分辨屬於哪個業務分區
         f'<path d="M{x} {y+10} a10,10 0 0 1 10,-10 h4 v{CARD_H} h-4 '
         f'a10,10 0 0 1 -10,-10 z" fill="{accent}"/>',
         txt(x + 26, y + 32, name, size=19, weight="700", fill=INK),
         txt(x + w - 18, y + 31, table, size=11.5, fill=INK_MUTE,
             anchor="end", family=MONO),
         txt(x + 26, y + 57, use, size=14, fill=INK_SUB),
         txt(x + 26, y + 79, "▸ " + why, size=12.5, fill=accent)]
    return "".join(p)


def group_height(n_cards):
    return GROUP_HEAD + n_cards * CARD_H + (n_cards - 1) * CARD_GAP + GROUP_PAD


def group(x, y, w, g):
    """一個業務分區（有淡底色的大框）。g = dict(title, note, color, items)"""
    accent, tint = THEME[g["color"]]
    h = group_height(len(g["items"]))
    p = [rect(x, y, w, h, tint, rx=16),
         txt(x + 22, y + 36, g["title"], size=20, weight="700", fill=accent),
         txt(x + 22, y + 58, g["note"], size=13, fill=INK_SUB)]
    cy = y + GROUP_HEAD
    for it in g["items"]:
        p.append(card(x + 22, cy, w - 44, it, accent))
        cy += CARD_H + CARD_GAP
    return "".join(p), h


def header(title, subtitle, callout, accent):
    """頁首：大標 + 副標 + 一句話重點框。董事長只讀這三行也能懂七成。"""
    p = [rect(MARGIN, 96, W - MARGIN * 2, 74, CALLOUT_BG, rx=14),
         txt(MARGIN + 4, 56, title, size=34, weight="700", fill=INK),
         txt(MARGIN + 4, 84, subtitle, size=15.5, fill=INK_SUB),
         txt(MARGIN + 26, 132, "一句話", size=13, weight="700", fill=accent),
         txt(MARGIN + 96, 133, callout, size=17, weight="600", fill=CALLOUT_FG),
         f'<line x1="{MARGIN+82}" y1="112" x2="{MARGIN+82}" y2="154" '
         f'stroke="{accent}" stroke-width="2.5" stroke-linecap="round"/>']
    return "".join(p)


def relation_band(x, y, w, rows, accent):
    """關聯總覽：把「哪張表連哪張表」翻譯成一句白話鏈條。

    每個 row 是 [膠囊, 連接詞, 膠囊, 連接詞, 膠囊 ...] 交錯排列。
    """
    h = 60 + len(rows) * 46 + 16
    p = [rect(x, y, w, h, PAPER, rx=16, stroke=CARD_BORDER),
         txt(x + 24, y + 36, "看圖重點：資料之間怎麼串起來", size=18,
             weight="700", fill=INK)]
    ry = y + 62
    for row in rows:
        cx = x + 26
        for i, seg in enumerate(row):
            if i % 2 == 0:                       # 偶數位＝資料膠囊
                pw = est_width(seg, 14) + 30
                p.append(rect(cx, ry, pw, 32, CARD_BG, rx=16,
                              stroke=accent, sw=1.4))
                p.append(txt(cx + pw / 2, ry + 21, seg, size=14,
                             weight="600", fill=accent, anchor="middle"))
                cx += pw + 8
            else:                                # 奇數位＝關係說明 + 箭頭
                lw = est_width(seg, 12.5) + 16
                p.append(txt(cx + lw / 2, ry + 13, seg, size=12.5,
                             fill=INK_SUB, anchor="middle"))
                p.append(line(cx + 2, ry + 22, cx + lw - 4, ry + 22,
                              ARROW_DIM, sw=1.6, marker="arrowDash"))
                cx += lw + 8
        ry += 46
    return "".join(p), h


def legend(x, y, w):
    """圖例：告訴讀者「方塊 / 灰字 / 顏色」各代表什麼。"""
    h = 54
    items = [("方塊 ＝ 一份資料（一張資料表）", INK),
             ("右上灰字 ＝ 系統內部名稱，跟工程師溝通用", INK_MUTE),
             ("▸ 彩色字 ＝ 這份資料為什麼對經營重要", THEME["gold"][0]),
             ("底色 ＝ 業務分區", INK_SUB)]
    p = [rect(x, y, w, h, CARD_BG, rx=12, stroke=CARD_BORDER)]
    cx = x + 24
    for s, c in items:
        p.append(f'<circle cx="{cx}" cy="{y+27}" r="4.5" fill="{c}"/>')
        p.append(txt(cx + 14, y + 32, s, size=13, fill=INK_SUB))
        cx += 14 + est_width(s, 13) + 34
    return "".join(p), h


def svg_wrap(width, height, title, body):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" '
            f'height="{height}" viewBox="0 0 {width} {height}" '
            f'font-family="{FONT}" role="img">'
            f'<title>{esc(title)}</title>'
            f'{defs()}'
            f'<rect width="{width}" height="{height}" fill="{CANVAS}"/>'
            f'{body}</svg>')


# ---------------------------------------------------------------------------
# 4. 版型 A：分區卡片圖（給 postgres / mysql 兩張用）
# ---------------------------------------------------------------------------

def build_card_diagram(meta, left_groups, right_groups, rel_rows, accent):
    body = [header(meta["title"], meta["subtitle"], meta["callout"], accent)]
    top = 200

    col_bottoms = []
    for cx, groups in ((MARGIN, left_groups),
                       (MARGIN + COL_W + COL_GAP, right_groups)):
        gy = top
        for g in groups:
            s, h = group(cx, gy, COL_W, g)
            body.append(s)
            gy += h + GROUP_GAP
        col_bottoms.append(gy - GROUP_GAP)

    y = max(col_bottoms) + 32
    s, h = relation_band(MARGIN, y, W - MARGIN * 2, rel_rows, accent)
    body.append(s)
    y += h + 20

    s, h = legend(MARGIN, y, W - MARGIN * 2)
    body.append(s)
    y += h

    body.append(txt(MARGIN + 4, y + 32, meta["footer"], size=12.5,
                    fill=INK_MUTE))
    return svg_wrap(W, y + 52, meta["title"], "".join(body))


# ---------------------------------------------------------------------------
# 5. 圖 1：PostgreSQL → 帳務與遊戲核心
# ---------------------------------------------------------------------------

PG_META = {
    "title": "幸運星幣城｜帳務與遊戲核心資料圖（經營層版）",
    "subtitle": "錢真正被計算的地方　—　技術名稱：PostgreSQL 帳務寫入主庫（對應 er-postgres.svg，共 16 份資料）",
    "callout": "玩家的每一塊錢——加值、下注、輸贏、返利、兌換——都在這裡計算，並留下永久可查的紀錄。",
    "footer": "資料來源：database/postgres/init.sql（2026-07-23 快照）｜工程師版見 er-postgres.svg，逐表說明見 注解-postgres.md",
}

PG_LEFT = [
    {"title": "💰 玩家金庫｜錢在這裡進出", "color": "gold",
     "note": "全站唯一會「動到錢」的區域，任何餘額變化都必須經過這裡",
     "items": [
         ("星幣錢包", "每位玩家目前有多少星幣，一人一個",
          "系統強制餘額不得為負，扣不出超過的錢", "wallets"),
         ("帳務流水", "每一筆錢的進出明細，只新增、絕不修改",
          "任何時點的帳都能重建，稽核與客訴爭議靠它", "wallet_transactions"),
         ("鑽石錢包", "第二種貨幣（點數卡兌換而來）的餘額",
          "與星幣分開管理，兩套規則互不干擾", "diamond_wallets"),
         ("待發通知箱", "錢動完後要通知其他系統，先寄存在這裡",
          "帳與通知同時成立，不會扣了錢卻沒人知道", "wallet_outbox"),
     ]},
    {"title": "💳 收入與回饋｜錢怎麼進來、怎麼還出去", "color": "emerald",
     "note": "每一分營收與每一次回饋都有單據可追",
     "items": [
         ("加值訂單", "玩家購買星幣的訂單與付款進度",
          "分階段記錄，卡在哪一步一目了然", "topup_orders"),
         ("虧損返利", "依玩家一段期間的淨虧損按比例回饋",
          "同一期間只發一次，排程重跑也不會重複發錢", "cashback_records"),
         ("商城兌換", "玩家用星幣換取禮品的扣款紀錄",
          "兌換與扣款綁在同一筆交易，不會換到卻沒扣", "shop_redemptions"),
     ]},
    {"title": "🏆 排行與資金分布", "color": "sky",
     "note": "誰在玩、玩多大、資金集中在誰手上",
     "items": [
         ("週排行歷史", "每週結算重置前，保存當週前段名單",
          "活動成效與獎勵發放的憑據", "rank_history"),
         ("每日持幣快照", "每天記錄一次玩家持有的星幣量",
          "看得出資金是集中在少數大戶還是分散", "rank_daily_snapshots"),
     ]},
]

PG_RIGHT = [
    {"title": "🎮 遊戲營運｜每一局的完整紀錄", "color": "violet",
     "note": "玩了什麼、賠了多少、賠率是否正常，都看這一區",
     "items": [
         ("對局紀錄", "每一局老虎機／百家樂／捕魚的下注與結果",
          "內含公平性驗證資料，玩家可自行驗證未被作弊", "game_rounds"),
         ("回報率統計", "每小時彙總各遊戲的下注額與派彩額比例",
          "賠率異常可即時發現，避免營收失控", "game_rtp_stats"),
         ("補付款單", "該派彩卻沒付成功的款項，排隊自動重試",
          "系統故障時玩家不會少拿到錢", "pending_wallet_credits"),
     ]},
    {"title": "🛡️ 管理與風控｜誰動了什麼、出了什麼事", "color": "rose",
     "note": "後台權力很大，所以每個動作都必須留痕",
     "items": [
         ("後台管理員", "後台人員的帳號與權限等級",
          "與玩家帳號完全隔離，權限不互通", "admin_users"),
         ("操作稽核紀錄", "後台每筆敏感操作（如發幣）的完整留痕",
          "可事後追責，防止內部舞弊", "admin_action_logs"),
         ("風控告警", "大額中獎、高頻下注等可疑行為自動告警",
          "有「待處理／已處理」工作流，不會漏看", "admin_alerts"),
         ("失敗訊息收容", "系統之間處理失敗的訊息集中保管",
          "錯誤不會被默默吞掉，可人工複查後補救", "dead_letter_messages"),
     ]},
]

PG_RELATIONS = [
    ["1 位玩家", "固定 1 個", "星幣錢包", "累積多筆", "帳務流水"],
    ["1 場對局", "同時產生", "下注扣款", "與", "派彩入帳"],
    ["1 筆加值訂單", "付款完成後", "1 筆入帳流水", "更新", "星幣錢包"],
    ["星幣錢包", "每日／每週拍照存檔", "排行與持幣快照"],
]


# ---------------------------------------------------------------------------
# 6. 圖 2：MySQL → 會員與營運活動
# ---------------------------------------------------------------------------

MY_META = {
    "title": "幸運星幣城｜會員與營運活動資料圖（經營層版）",
    "subtitle": "玩家是誰、在玩什麼、被什麼留住　—　技術名稱：MySQL 查詢讀庫（對應 er-mysql.svg，共 12 份資料）",
    "callout": "這裡放「查得多、改得少」的資料。玩家再怎麼查，都不會拖慢金庫那邊的帳務計算。",
    "footer": "資料來源：database/mysql/init.sql（2026-07-23 快照）｜工程師版見 er-mysql.svg，逐表說明見 注解-mysql.md",
}

MY_LEFT = [
    {"title": "👤 會員與社交｜玩家是誰、跟誰玩", "color": "indigo",
     "note": "全系統認人的源頭，也是社交黏著度的基礎",
     "items": [
         ("玩家主檔", "每位玩家的帳號、暱稱、頭像與狀態",
          "全系統靠它認人；停權從這裡生效", "members"),
         ("好友關係", "好友申請、接受、拒絕的目前狀態",
          "一段關係只存一筆，不會重複申請或誤加自己", "friendships"),
         ("好友贈禮紀錄", "誰送誰星幣的社交行為歷史",
          "每日贈送上限即時控管，防分身刷幣", "gift_logs"),
     ]},
    {"title": "🎯 任務與簽到｜把玩家留下來的機制", "color": "teal",
     "note": "留存率與日活的主要推手，營運可自行調整",
     "items": [
         ("任務模板", "營運預先設定的任務內容與獎勵金額",
          "改一次獎勵，全站玩家同步生效，不用改程式", "task_definitions"),
         ("玩家任務進度", "每位玩家各項任務目前做到第幾步",
          "一人一任務只有一筆進度，不會重複領獎", "player_tasks"),
         ("每日簽到", "誰在哪一天簽到、目前連續幾天",
          "同一天只能簽一次，連點也擋得住", "daily_checkins"),
         ("月度大獎領取", "當月累計 10／20／28 天的里程碑獎勵",
          "同一里程碑不會被重複領走", "monthly_reward_claims"),
     ]},
]

MY_RIGHT = [
    {"title": "🎁 商城與鑽石｜付費轉換的入口", "color": "gold",
     "note": "營運可自行上下架與調價，不需工程師介入",
     "items": [
         ("商城商品目錄", "禮品品項、兌換價格與上下架狀態",
          "後台即時調整，玩家端立刻看到", "shop_items"),
         ("鑽石點數卡", "後台批次產生的兌換序號與面額",
          "一組序號只能被兌換一次，搶兌也只有一人成功", "diamond_cards"),
     ]},
    {"title": "📊 查詢複本與維運｜讓查詢快又不影響帳務", "color": "slate",
     "note": "這一區是「副本與工具」，不是帳務正本",
     "items": [
         ("帳務明細複本", "玩家翻閱交易明細用的唯讀副本",
          "⚠️ 餘額仍以金庫為準，這裡可能慢幾秒", "wallet_transactions"),
         ("待發通知箱", "會員端要送出的系統通知暫存區",
          "與金庫同一套機制，通知不漏發", "outbox_events"),
         ("系統健康檢查", "各項服務是否仍正常運作",
          "服務掛掉能被即時發現，縮短停機時間", "system_health_check"),
     ]},
]

MY_RELATIONS = [
    ["玩家主檔的編號", "就是全站通用身分", "所有服務認同一位玩家"],
    ["1 張任務模板", "對應到", "全體玩家的個別進度"],
    ["每日簽到", "當月累計滿 10／20／28 天", "月度大獎領取"],
    ["商城商品目錄", "先驗價，再到金庫扣款", "商城兌換（帳務圖）"],
]


# ---------------------------------------------------------------------------
# 7. 圖 3：跨庫資料流（獨立版型 B）
# ---------------------------------------------------------------------------

FLOW_META = {
    "title": "幸運星幣城｜一筆錢的旅程：兩個資料庫如何協作（經營層版）",
    "subtitle": "為什麼要分兩個資料庫，以及它們怎麼保持一致　—　對應 er-cross-db-cqrs.svg",
    "callout": "錢只在一個地方算，算完廣播出去，其他系統各自更新自己的複本。",
    "footer": "對應技術名詞：CQRS 讀寫分離（ADR-001）、Transactional Outbox、至少投遞一次 + 下游冪等｜逐項說明見 注解-cross-db-cqrs.md",
}


def chip(x, y, w, title, sub, accent, h=104, table=""):
    """資料流圖用的方塊，比卡片版型再簡化一層。"""
    p = [rect(x, y, w, h, CARD_BG, rx=12, stroke=accent, sw=1.6,
              extra=' filter="url(#sh)"'),
         txt(x + w / 2, y + 34, title, size=18, weight="700", fill=INK,
             anchor="middle"),
         txt(x + w / 2, y + 60, sub, size=13, fill=INK_SUB, anchor="middle")]
    if table:
        p.append(txt(x + w / 2, y + 84, table, size=11, fill=INK_MUTE,
                     anchor="middle", family=MONO))
    return "".join(p)


def build_flow_diagram():
    accent_pg, tint_pg = THEME["gold"]
    accent_my, tint_my = THEME["indigo"]
    accent_kf, tint_kf = THEME["violet"]

    # 四個直欄：col1 與 col2 之間留寬一點，塞得下「同一筆交易寫入」箭頭
    cw = 332
    cx = [40, 522, 914, 1306]
    center = [x + cw / 2 for x in cx]

    zone_top_y, zone_h = 210, 196
    chip_top_y = zone_top_y + 58
    zone_bot_y = 640
    chip_bot_y = zone_bot_y + 58
    chip_h = 104
    kafka_y, kafka_h = 470, 96

    b = [header(FLOW_META["title"], FLOW_META["subtitle"],
                FLOW_META["callout"], accent_kf)]

    # --- 上方：查詢庫（MySQL） -------------------------------------------
    b.append(rect(MARGIN - 8, zone_top_y, W - (MARGIN - 8) * 2, zone_h,
                  tint_my, rx=16))
    b.append(txt(MARGIN + 16, zone_top_y + 36, "📚 查詢庫｜玩家與營運資料的家",
                 size=20, weight="700", fill=accent_my))
    b.append(txt(W - MARGIN - 16, zone_top_y + 36,
                 "技術名稱：MySQL 讀庫　·　可容忍幾秒延遲", size=13,
                 fill=INK_SUB, anchor="end"))
    for i, (t, s, tb) in enumerate([
            ("玩家主檔", "誰是誰、帳號狀態", "members"),
            ("帳務明細複本", "供玩家翻閱歷史（唯讀）", "wallet_transactions"),
            ("鑽石點數卡", "序號與面額", "diamond_cards"),
            ("商城商品目錄", "品項與兌換價", "shop_items")]):
        b.append(chip(cx[i], chip_top_y, cw, t, s, accent_my, chip_h, tb))

    # --- 中間：廣播中心（Kafka） -----------------------------------------
    b.append(chip(cx[1], kafka_y, cw, "📢 廣播中心",
                  "「已入帳／已扣款」事件", accent_kf, kafka_h, "Kafka"))

    # --- 下方：金庫（PostgreSQL） ----------------------------------------
    b.append(rect(MARGIN - 8, zone_bot_y, W - (MARGIN - 8) * 2, zone_h,
                  tint_pg, rx=16))
    b.append(txt(MARGIN + 16, zone_bot_y + 36, "🏦 金庫｜錢真正被計算的地方",
                 size=20, weight="700", fill=accent_pg))
    b.append(txt(W - MARGIN - 16, zone_bot_y + 36,
                 "技術名稱：PostgreSQL 寫庫　·　要求絕對正確", size=13,
                 fill=INK_SUB, anchor="end"))
    for i, (t, s, tb) in enumerate([
            ("星幣錢包 ＋ 帳務流水", "扣款、入帳都在這算", "wallets / wallet_transactions"),
            ("待發通知箱", "還沒送出的通知", "wallet_outbox"),
            ("鑽石錢包", "鑽石餘額", "diamond_wallets"),
            ("商城兌換紀錄", "兌換扣款憑據", "shop_redemptions")]):
        b.append(chip(cx[i], chip_bot_y, cw, t, s, accent_pg, chip_h, tb))

    chip_top_bottom = chip_top_y + chip_h      # 上方方塊的下緣
    chip_bot_top = chip_bot_y                  # 下方方塊的上緣

    # ① 金庫內部：改錢與寫通知綁在同一筆交易
    b.append(line(cx[0] + cw + 6, chip_bot_y + 52, cx[1] - 10,
                  chip_bot_y + 52, accent_pg, sw=2.5, marker="arrowGold"))
    b.append(txt((cx[0] + cw + cx[1]) / 2, chip_bot_y + 40, "① 同一筆交易寫入",
                 size=12.5, weight="600", fill=accent_pg, anchor="middle"))

    # ② 待發通知箱 → 廣播中心（往上）
    b.append(line(center[1], chip_bot_top - 6, center[1], kafka_y + kafka_h + 10,
                  ARROW, sw=2.5, marker="arrowSolid"))
    b.append(txt(center[1] + 16, chip_bot_top - 62, "② 郵差程式定時送出",
                 size=12.5, weight="600", fill=INK))
    b.append(txt(center[1] + 16, chip_bot_top - 42, "確認送達才銷單",
                 size=12.5, fill=INK_SUB))

    # ③ 廣播中心 → 帳務明細複本（往上）
    b.append(line(center[1], kafka_y - 6, center[1], chip_top_bottom + 10,
                  ARROW, sw=2.5, marker="arrowSolid"))
    b.append(txt(center[1] + 16, kafka_y - 52, "③ 查詢庫更新複本",
                 size=12.5, weight="600", fill=INK))
    b.append(txt(center[1] + 16, kafka_y - 32, "重複收到也只算一次",
                 size=12.5, fill=INK_SUB))

    # ④⑤⑥ 三條虛線＝跨庫「靠約定對應」，資料庫本身不強制
    for i, (l1, l2) in [(0, ("④ 玩家編號", "＝跨庫共用身分")),
                        (2, ("⑥ 序號兌換", "→ 鑽石入帳")),
                        (3, ("⑤ 先驗價", "→ 再到金庫扣款"))]:
        b.append(line(center[i], chip_top_bottom + 6, center[i],
                      chip_bot_top - 10, ARROW_DIM, sw=2, dash="7 6",
                      marker="arrowDash"))
        b.append(txt(center[i] + 14, 500, l1, size=12.5, weight="600",
                     fill=INK_SUB))
        b.append(txt(center[i] + 14, 520, l2, size=12.5, fill=INK_MUTE))

    # --- 底部：三個對經營層的保證 ---------------------------------------
    gy = 890
    # SVG 的 <text> 不會自動換行，中文也沒有空白可斷，所以直接手寫兩行
    guarantees = [
        ("✅ 不會漏帳",
         ["改動餘額與記下「要發的通知」寫在同一筆交易，", "不可能只做一半。"],
         "emerald"),
        ("✅ 不會重複扣款",
         ["同一筆操作若被重送，第二次會被系統自動擋下，", "錢只算一次。"],
         "emerald"),
        ("⚠️ 明細有數秒延遲",
         ["查詢庫是複本，餘額一律以金庫為準。", "已有每日對帳工具核對兩邊。"],
         "rose"),
    ]
    gw, ggap = 520, 30
    for i, (t, lines, color) in enumerate(guarantees):
        a, tint = THEME[color]
        x = 30 + i * (gw + ggap)
        b.append(rect(x, gy, gw, 150, tint, rx=14))
        b.append(txt(x + 24, gy + 42, t, size=20, weight="700", fill=a))
        for j, ln in enumerate(lines):
            b.append(txt(x + 24, gy + 78 + j * 24, ln, size=14.5, fill=INK))
    gy += 150 + 20

    # 圖例
    b.append(rect(MARGIN - 8, gy, W - (MARGIN - 8) * 2, 54, CARD_BG, rx=12,
                  stroke=CARD_BORDER))
    b.append(line(MARGIN + 16, gy + 27, MARGIN + 64, gy + 27, ARROW,
                  sw=2.5, marker="arrowSolid"))
    b.append(txt(MARGIN + 78, gy + 32, "實線 ＝ 資料真的搬過去", size=13,
                 fill=INK_SUB))
    b.append(line(MARGIN + 300, gy + 27, MARGIN + 348, gy + 27, ARROW_DIM,
                  sw=2, dash="7 6", marker="arrowDash"))
    b.append(txt(MARGIN + 362, gy + 32,
                 "虛線 ＝ 兩邊靠共同編號對應（資料庫不強制，靠程式與對帳維持）",
                 size=13, fill=INK_SUB))
    gy += 54

    b.append(txt(MARGIN + 4, gy + 32, FLOW_META["footer"], size=12.5,
                 fill=INK_MUTE))
    return svg_wrap(W, gy + 52, FLOW_META["title"], "".join(b))


# ---------------------------------------------------------------------------
# 8. 進入點
# ---------------------------------------------------------------------------

def main():
    out_dir = Path(__file__).resolve().parent
    # 兩種配色各輸出一組。淺色沿用原檔名（文件與簡報已經引用，不要改動）；
    # 深色加 `-深色` 後綴，給深底簡報 / 螢幕觀看用。
    for mode, suffix in (("light", ""), ("dark", "-深色")):
        use_theme(mode)
        files = {
            f"er-postgres-董事長版{suffix}.svg": build_card_diagram(
                PG_META, PG_LEFT, PG_RIGHT, PG_RELATIONS, THEME["gold"][0]),
            f"er-mysql-董事長版{suffix}.svg": build_card_diagram(
                MY_META, MY_LEFT, MY_RIGHT, MY_RELATIONS, THEME["indigo"][0]),
            f"er-cross-db-cqrs-董事長版{suffix}.svg": build_flow_diagram(),
        }
        for name, content in files.items():
            path = out_dir / name
            path.write_text(content, encoding="utf-8")
            print(f"[ok] {mode:<5} {path.name}  ({len(content):,} bytes)")


if __name__ == "__main__":
    main()
