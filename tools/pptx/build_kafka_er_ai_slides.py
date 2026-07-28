#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
在既有簡報上新增 12 頁原生 PPT 版面（不插圖片），並重排結構。

新增內容：
  A. 資料模型精簡版 ×2（PostgreSQL 寫庫 / MySQL 讀庫）—— 放到原 ER 圖位置（第 3 頁起）
  B. Kafka 事件驅動架構 ×5 —— 插在「請求流程」之後，當作流量段落的亮點
  C. CQRS 合併版 ×1 —— 取代原本重複的「資料層設計」與「資料層架構」兩頁
  D. AI 協作 ×4 —— 插在「總結」之前

結構調整：
  - 刪除原第 24、30 頁（CQRS 重複頁）
  - 原第 3、4、5 頁（完整版 ER）移到最後附錄區

所有頁面都用 python-pptx 畫原生圖形（矩形／圓角矩形／文字框），
配色與字體沿用原簡報：底 #141833、金 #C9A227、面板 #1B1F3B、標題 Cambria、內文 Calibri。

用法：
    python tools/pptx/build_kafka_er_ai_slides.py <來源.pptx> <輸出.pptx>
"""

import sys
from pptx import Presentation
from pptx.util import Emu, Pt
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_SHAPE
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR

# --------------------------------------------------------------------------
# 版面常數：全部沿用原簡報量到的數值，新頁才不會看起來像外掛上去的
# --------------------------------------------------------------------------
SLIDE_W = 12192000
SLIDE_H = 6858000

MARGIN = 548640                       # 左右邊界（0.6 吋）
CONTENT_W = SLIDE_W - MARGIN * 2      # 可用寬度

Y_EYEBROW = 411480                    # 小標（金色）
Y_TITLE = 731520                      # 主標（Cambria）
Y_SUBTITLE = 1316736                  # 副標
Y_CONTENT = 1920240                   # 內容區起點
Y_FOOTER = 6473952                    # 頁尾

# 配色
C_BG = RGBColor(0x14, 0x18, 0x33)      # 頁面底色
C_PANEL = RGBColor(0x1B, 0x1F, 0x3B)   # 深色卡片
C_PANEL2 = RGBColor(0x3A, 0x40, 0x76)  # 強調帶
C_GOLD = RGBColor(0xC9, 0xA2, 0x27)    # 主金
C_GOLD_L = RGBColor(0xE4, 0xC7, 0x66)  # 亮金（小字用，深底上比較清楚）
C_WHITE = RGBColor(0xFF, 0xFF, 0xFF)
C_BODY = RGBColor(0xD9, 0xDE, 0xF2)    # 內文
C_SUB = RGBColor(0xA9, 0xAF, 0xCC)     # 次要文字
C_SUB2 = RGBColor(0x8A, 0x8F, 0xB0)    # 頁尾／註解
C_INK = RGBColor(0x14, 0x18, 0x33)     # 金底上的深色字
C_WARN = RGBColor(0xC8, 0x7B, 0x4A)    # 反例用的暖色（原簡報既有色系）
C_LINE = RGBColor(0x5B, 0x68, 0x80)    # 分隔線

FONT_TITLE = "Cambria"
FONT_BODY = "Calibri"


# --------------------------------------------------------------------------
# 繪圖小工具
# --------------------------------------------------------------------------
def new_slide(prs):
    """開一張空白頁並鋪上深色底。layout 0（DEFAULT）沒有任何 placeholder，最乾淨。"""
    slide = prs.slides.add_slide(prs.slide_layouts[0])
    fill = slide.background.fill
    fill.solid()
    fill.fore_color.rgb = C_BG
    return slide


def box(slide, x, y, w, h, fill=None, line=None, shape=MSO_SHAPE.RECTANGLE, line_w=Pt(1)):
    """畫一個色塊。fill=None 表示透明；line=None 表示無框線。"""
    sp = slide.shapes.add_shape(shape, Emu(x), Emu(y), Emu(w), Emu(h))
    if fill is None:
        sp.fill.background()
    else:
        sp.fill.solid()
        sp.fill.fore_color.rgb = fill
    if line is None:
        sp.line.fill.background()
    else:
        sp.line.color.rgb = line
        sp.line.width = line_w
    sp.shadow.inherit = False
    # 色塊本身不放字，關掉自動調整避免 PowerPoint 亂縮
    sp.text_frame.word_wrap = True
    return sp


def text(slide, x, y, w, h, paragraphs, align=PP_ALIGN.LEFT, anchor=MSO_ANCHOR.TOP,
         line_spacing=None):
    """
    放一個文字框。paragraphs 是「段落清單」，每段是「run 清單」，
    每個 run 為 (文字, 級數pt, 顏色, 粗體, 字型) —— 後三項可省略。
    """
    tb = slide.shapes.add_textbox(Emu(x), Emu(y), Emu(w), Emu(h))
    tf = tb.text_frame
    tf.word_wrap = True
    tf.vertical_anchor = anchor
    tf.margin_left = 0
    tf.margin_right = 0
    tf.margin_top = 0
    tf.margin_bottom = 0

    for i, runs in enumerate(paragraphs):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        p.alignment = align
        if line_spacing:
            p.line_spacing = line_spacing
        for spec in runs:
            content = spec[0]
            size = spec[1] if len(spec) > 1 else 11
            color = spec[2] if len(spec) > 2 else C_BODY
            bold = spec[3] if len(spec) > 3 else False
            font = spec[4] if len(spec) > 4 else FONT_BODY
            r = p.add_run()
            r.text = content
            r.font.size = Pt(size)
            r.font.color.rgb = color
            r.font.bold = bold
            r.font.name = font
    return tb


def header(slide, eyebrow, title, subtitle, footer, title_size=26):
    """每頁共用的頁首三行 ＋ 頁尾。"""
    text(slide, MARGIN, Y_EYEBROW, CONTENT_W, 320040,
         [[(eyebrow, 12, C_GOLD_L, True)]], anchor=MSO_ANCHOR.MIDDLE)
    text(slide, MARGIN, Y_TITLE, CONTENT_W, 640080,
         [[(title, title_size, C_WHITE, True, FONT_TITLE)]], anchor=MSO_ANCHOR.MIDDLE)
    text(slide, MARGIN, Y_SUBTITLE, CONTENT_W, 365760,
         [[(subtitle, 13, C_GOLD_L)]], anchor=MSO_ANCHOR.MIDDLE)
    text(slide, MARGIN, Y_FOOTER, 7315200, 274320,
         [[(footer, 10, C_SUB2)]])


def takeaway(slide, y, msg, fill=None, h=430000, size=12.5, color=C_SUB2,
             align=PP_ALIGN.CENTER):
    """底部一句收束。給 fill 就畫成強調帶。"""
    if fill is not None:
        box(slide, MARGIN, y, CONTENT_W, h, fill=fill, shape=MSO_SHAPE.ROUNDED_RECTANGLE)
        color = C_BODY
    text(slide, MARGIN + 160000, y, CONTENT_W - 320000, h,
         [[(msg, size, color)]], align=align, anchor=MSO_ANCHOR.MIDDLE)


def arrow(slide, x, y, w, h, size=20):
    text(slide, x, y, w, h, [[("→", size, C_GOLD, True)]],
         align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)


def card(slide, x, y, w, h, heading, sub=None, fill=C_PANEL, bar=C_GOLD, bar_h=300000):
    """深色卡片 ＋ 頂部金色標題條。回傳內容區可用的 y 起點。"""
    box(slide, x, y, w, h, fill=fill, shape=MSO_SHAPE.ROUNDED_RECTANGLE)
    box(slide, x, y, w, bar_h, fill=bar, shape=MSO_SHAPE.ROUNDED_RECTANGLE)
    text(slide, x + 100000, y, w - 200000, bar_h,
         [[(heading, 11.5, C_INK, True)]], align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)
    inner_y = y + bar_h + 120000
    if sub:
        text(slide, x + 140000, inner_y, w - 280000, 240000,
             [[(sub, 9, C_SUB)]], align=PP_ALIGN.CENTER)
        inner_y += 260000
    return inner_y


def bullet_list(slide, x, y, w, items, size=10, gap=300000, color=C_BODY, marker="・"):
    """簡單的條列，回傳結束後的 y。"""
    cur = y
    for it in items:
        text(slide, x, cur, w, gap, [[(marker + it, size, color)]])
        cur += gap
    return cur


# --------------------------------------------------------------------------
# A. 資料模型精簡版
# --------------------------------------------------------------------------
PG_BLOCKS = [
    ("錢包核心", "全站唯一會動到錢的區域", [
        ("wallets", "餘額本體，version 樂觀鎖防超扣"),
        ("wallet_transactions", "每筆異動，冪等鍵防重複入帳"),
        ("wallet_outbox", "事件外寄箱，與帳務同一交易"),
        ("pending_wallet_credits", "派彩失敗的補償單"),
        ("shop_redemptions", "商城兌換紀錄"),
    ]),
    ("收入與回饋", "每分營收與回饋都有單據", [
        ("topup_orders", "加值訂單"),
        ("cashback_records", "虧損返利，每期一筆"),
        ("diamond_wallets", "鑽石錢包"),
    ]),
    ("遊戲營運", "每一局都留完整紀錄", [
        ("game_rounds", "對局紀錄，下注與派彩"),
        ("game_rtp_stats", "回報率統計，每小時彙總"),
    ]),
    ("排行與資金分布", "定期拍快照存歷史", [
        ("rank_history", "週排行歷史"),
        ("rank_daily_snapshots", "每日持幣快照"),
    ]),
    ("後台與可靠性", "權力大，所以每個動作都留痕", [
        ("admin_users", "後台管理員"),
        ("admin_action_logs", "操作稽核紀錄"),
        ("admin_alerts", "風控告警"),
        ("dead_letter_messages", "失敗訊息收容"),
    ]),
]

MYSQL_BLOCKS = [
    ("會員與社交", "全系統認人的源頭", [
        ("members", "玩家主檔，所有 player_id 的出處"),
        ("member_social_accounts", "第三方登入綁定"),
        ("friendships", "好友關係"),
        ("gift_logs", "好友贈禮紀錄"),
    ]),
    ("任務與簽到", "留存率與日活的主要推手", [
        ("task_definitions", "任務模板"),
        ("player_tasks", "玩家任務進度"),
        ("daily_checkins", "每日簽到"),
        ("monthly_reward_claims", "月度大獎領取"),
    ]),
    ("商城與鑽石", "營運可自行上下架與調價", [
        ("shop_items", "商城商品目錄"),
        ("diamond_cards", "鑽石點數卡"),
    ]),
    ("查詢複本與維運", "副本與工具，不是帳務正本", [
        ("wallet_transactions", "帳務明細讀視圖，只讀不寫"),
        ("outbox_events", "會員側事件外寄箱"),
        ("system_health_check", "系統健康檢查"),
    ]),
]


def build_er_slide(prs, idx_label, title, subtitle, blocks, footer, tail):
    slide = new_slide(prs)
    header(slide, "資料模型・精簡版　%s" % idx_label, title, subtitle, footer, title_size=25)

    n = len(blocks)
    gap = 150000
    w = (CONTENT_W - gap * (n - 1)) // n
    top = Y_CONTENT
    h = 3560000
    row_h = 500000

    for i, (name, note, tables) in enumerate(blocks):
        x = MARGIN + i * (w + gap)
        inner = card(slide, x, top, w, h, name)
        cur = inner + 40000
        for tname, tnote in tables:
            text(slide, x + 130000, cur, w - 260000, 200000,
                 [[(tname, 9.5, C_GOLD_L, True)]])
            text(slide, x + 130000, cur + 195000, w - 260000, 300000,
                 [[(tnote, 8.5, C_SUB)]])
            cur += row_h
        # 區塊說明壓在卡片底部：各區表數不一，靠這條帶子把高度差吃掉
        sy = top + h - 500000
        box(slide, x + 120000, sy, w - 240000, 440000, fill=C_PANEL2,
            shape=MSO_SHAPE.ROUNDED_RECTANGLE)
        text(slide, x + 170000, sy, w - 340000, 440000,
             [[(note, 9, C_GOLD_L)]], align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)

    takeaway(slide, top + h + 240000, tail, size=12.5)
    return slide


def slide_er_pg(prs):
    return build_er_slide(
        prs, "1／2",
        "PostgreSQL 帳務寫庫 —— 16 張表，五個責任區",
        "先看「誰負責什麼」就好；完整關聯圖（含一對多標記）放在最後附錄",
        PG_BLOCKS,
        "幸運星幣城｜資料模型精簡版（PostgreSQL 寫庫）",
        "一句話記住這張圖：只要會動到錢，就一定落在「錢包核心」這一區 —— 其餘四區都是圍著它做紀錄與稽核。",
    )


def slide_er_mysql(prs):
    return build_er_slide(
        prs, "2／2",
        "MySQL 查詢讀庫 —— 13 張表，四個責任區",
        "這一側服務「查得快」；帳務正本永遠在 PostgreSQL，不在這裡",
        MYSQL_BLOCKS,
        "幸運星幣城｜資料模型精簡版（MySQL 讀庫）",
        "分庫的判準很單純：會影響餘額的寫在 PostgreSQL，只是要「查」的放 MySQL —— 查詢再重也壓不到下注。",
    )


# --------------------------------------------------------------------------
# B. Kafka 事件驅動架構 ×5
# --------------------------------------------------------------------------
TOPICS = [
    ("member.registered", "3 partition", "member-service", "wallet 開錢包 · rank 建榜位", "事件"),
    ("wallet.credit.request", "6 partition", "member-service", "wallet 執行入帳", "指令"),
    ("wallet.credit", "6 partition", "wallet-service", "讀庫同步 · rank 計分 · admin 報表", "事件"),
    ("wallet.debit", "6 partition", "wallet-service", "讀庫同步 · rank 計分 · admin 報表", "事件"),
    ("game.result", "6 partition", "game-service", "rank 計分 · notification 推播 · admin RTP", "事件"),
    ("rank.update", "3 partition", "rank-service", "notification 名次變動推播", "事件"),
    ("notification.push", "6 partition", "rank · admin", "notification 走 WebSocket 送到前端", "指令"),
    ("friend.relationship.updated", "3 partition", "member-service", "rank 重建好友榜", "事件"),
]


def slide_kafka_overview(prs):
    slide = new_slide(prs)
    header(slide, "事件驅動架構・01／05",
           "8 條業務事件流，把 7 個服務黏起來又不綁死",
           "服務之間不互相呼叫，只發事件；誰需要就自己訂閱 —— 加一個消費者，發送端一行都不用改",
           "幸運星幣城｜Kafka 事件骨幹")

    cols, gap_x, gap_y = 4, 150000, 150000
    w = (CONTENT_W - gap_x * (cols - 1)) // cols
    h = 1290000
    top = Y_CONTENT - 60000

    for i, (name, parts, producer, consumers, kind) in enumerate(TOPICS):
        r, c = divmod(i, cols)
        x = MARGIN + c * (w + gap_x)
        y = top + r * (h + gap_y)
        box(slide, x, y, w, h, fill=C_PANEL, shape=MSO_SHAPE.ROUNDED_RECTANGLE)
        # 指令 / 事件 的色票：指令用金底，事件用鋼藍底，一眼分得出語意
        tag_fill = C_GOLD if kind == "指令" else C_PANEL2
        tag_ink = C_INK if kind == "指令" else C_GOLD_L
        box(slide, x + 130000, y + 120000, 480000, 220000, fill=tag_fill,
            shape=MSO_SHAPE.ROUNDED_RECTANGLE)
        text(slide, x + 130000, y + 120000, 480000, 220000,
             [[(kind, 8.5, tag_ink, True)]], align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)
        text(slide, x + 650000, y + 120000, w - 780000, 220000,
             [[(parts, 8.5, C_SUB2)]], align=PP_ALIGN.RIGHT, anchor=MSO_ANCHOR.MIDDLE)
        text(slide, x + 130000, y + 440000, w - 260000, 260000,
             [[(name, 10.5, C_GOLD_L, True)]])
        text(slide, x + 130000, y + 740000, w - 260000, 470000,
             [[(producer, 9, C_WHITE, True)], [("→ " + consumers, 8.5, C_SUB)]])

    band_y = top + 2 * h + gap_y + 180000
    box(slide, MARGIN, band_y, CONTENT_W, 700000, fill=C_PANEL2,
        shape=MSO_SHAPE.ROUNDED_RECTANGLE)
    text(slide, MARGIN + 200000, band_y, CONTENT_W - 400000, 700000,
         [[("＋ 5 條 DLT 死信 topic", 12.5, C_GOLD_L, True),
           ("　　member.registered.DLT · wallet.credit.DLT · wallet.debit.DLT · "
            "wallet.credit.request.DLT · friend.relationship.updated.DLT", 10, C_BODY)],
          [("重試多次仍失敗的訊息會被搬到這裡，讓正常訊息繼續跑 —— 詳見本節最後一頁。", 10, C_SUB)]],
         anchor=MSO_ANCHOR.MIDDLE)

    takeaway(slide, band_y + 800000,
             "partition 數不是隨便給的：高流量 topic 給 6、低流量給 3；"
             "producer 一律以 playerId 當 key，所以同一個玩家的事件永遠落同一個 partition、順序不會亂。")
    return slide


def slide_kafka_why(prs):
    slide = new_slide(prs)
    header(slide, "事件驅動架構・02／05",
           "下注這條路上只留「錢」，其餘全部交給 Kafka",
           "同步鏈路每多做一件事，單機容量就少一分 —— 所以我們只留「錯了就必須當場拒絕」的",
           "幸運星幣城｜為什麼要事件驅動")

    gap = 260000
    w = (CONTENT_W - gap) // 2
    top = Y_CONTENT
    h = 3300000
    step_gap = 500000

    # 左：同步鏈路
    inner = card(slide, MARGIN, top, w, h, "同步・非做完不可", "錯了就要當場拒絕玩家")
    steps = [
        ("Gateway", "JWT 驗證、限流、在途卸載"),
        ("game-service", "算出這一局的結果（Provably Fair）"),
        ("wallet-service", "扣款：餘額守衛 ＋ 冪等鍵"),
        ("PostgreSQL", "落帳，ACID 交易內完成派彩"),
        ("回應玩家", "整條鏈路走完才回傳結果"),
    ]
    cur = inner + 40000
    for i, (name, note) in enumerate(steps, 1):
        box(slide, MARGIN + 140000, cur, 300000, 300000, fill=C_GOLD,
            shape=MSO_SHAPE.ROUNDED_RECTANGLE)
        text(slide, MARGIN + 140000, cur, 300000, 300000,
             [[(str(i), 10, C_INK, True)]], align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)
        text(slide, MARGIN + 530000, cur - 20000, w - 700000, 200000,
             [[(name, 11, C_WHITE, True)]])
        text(slide, MARGIN + 530000, cur + 180000, w - 700000, 220000,
             [[(note, 9, C_SUB)]])
        cur += step_gap

    # 右：非同步
    x2 = MARGIN + w + gap
    inner2 = card(slide, x2, top, w, h, "非同步・晚幾秒沒人在意", "交給 Kafka，玩家不必等它跑完",
                  bar=C_PANEL2)
    asyncs = [
        ("排行榜計分", "wallet.debit / wallet.credit → rank-service"),
        ("MySQL 讀庫同步", "wallet.credit / wallet.debit → 交易讀視圖"),
        ("WebSocket 推播", "game.result / rank.update → notification"),
        ("後台報表", "game.result → admin 的 RTP 與流通量統計"),
        ("好友榜重建", "friend.relationship.updated → rank"),
    ]
    cur = inner2 + 40000
    for name, note in asyncs:
        box(slide, x2 + 140000, cur + 90000, 120000, 120000, fill=C_GOLD_L,
            shape=MSO_SHAPE.OVAL)
        text(slide, x2 + 380000, cur - 20000, w - 520000, 200000,
             [[(name, 11, C_WHITE, True)]])
        text(slide, x2 + 380000, cur + 180000, w - 520000, 220000,
             [[(note, 9, C_SUB)]])
        cur += step_gap

    takeaway(slide, top + h + 240000,
             "這不是為了架構好看：熱路徑每砍掉一次跨服務往返，單機吞吐就多一截。"
             "實測全鏈路 200 req/s，最後的瓶頸落在資料庫交易容量（約 575 tx/s），而不是事件管道。",
             fill=C_PANEL2, h=520000)
    return slide


def slide_kafka_command_event(prs):
    slide = new_slide(prs)
    header(slide, "事件驅動架構・03／05",
           "一個字之差：request 是「請你入帳」，沒有 request 是「已經入帳了」",
           "ADR-002：指令與事件不分開，wallet 會消費到自己發出的訊息 —— 無限迴圈",
           "幸運星幣城｜指令與事件分離（ADR-002）")

    top = Y_CONTENT - 40000
    h_row = 1500000
    gutter = 280000

    # 反例
    box(slide, MARGIN, top, CONTENT_W, h_row, fill=C_PANEL,
        shape=MSO_SHAPE.ROUNDED_RECTANGLE)
    box(slide, MARGIN, top, 46000, h_row, fill=C_WARN)
    text(slide, MARGIN + 220000, top + 90000, CONTENT_W - 440000, 300000,
         [[("✗　如果只有一個 wallet.credit", 12.5, C_WARN, True)]])
    flow_bad = ["wallet 入帳完成", "發出 wallet.credit", "wallet 自己的 listener 收到",
                "又呼叫一次 credit()", "再發一次事件 …"]
    seg = (CONTENT_W - 440000) // len(flow_bad)
    for i, label in enumerate(flow_bad):
        bx = MARGIN + 220000 + i * seg
        text(slide, bx, top + 520000, seg - gutter, 800000,
             [[(label, 10.5, C_BODY if i < 4 else C_WARN, i == 4)]], anchor=MSO_ANCHOR.MIDDLE)
        if i < len(flow_bad) - 1:
            arrow(slide, bx + seg - gutter, top + 520000, gutter, 800000, size=15)
    text(slide, MARGIN + 220000, top + 1080000, CONTENT_W - 440000, 320000,
         [[("餘額會一路長大，而且整個過程不會拋任何例外 —— 沒有錯誤訊息可以看。", 10, C_SUB)]])

    # 正解
    top2 = top + h_row + 220000
    h_row2 = h_row + 150000
    box(slide, MARGIN, top2, CONTENT_W, h_row2, fill=C_PANEL,
        shape=MSO_SHAPE.ROUNDED_RECTANGLE)
    box(slide, MARGIN, top2, 46000, h_row2, fill=C_GOLD)
    text(slide, MARGIN + 220000, top2 + 90000, CONTENT_W - 440000, 300000,
         [[("✓　拆成「指令」與「事件」兩個 topic", 12.5, C_GOLD_L, True)]])
    flow_good = [
        ("member-service", "簽到／新手禮／月獎", None),
        ("wallet.credit.request", "指令：請你入帳", "指令"),
        ("wallet-service", "驗冪等 → 入帳 → 落帳", None),
        ("wallet.credit", "事件：已經入帳了", "事件"),
        ("rank · 讀庫 · admin", "各自訂閱，互不知道對方", None),
    ]
    seg2 = (CONTENT_W - 440000) // len(flow_good)
    for i, (name, note, tag) in enumerate(flow_good):
        bx = MARGIN + 220000 + i * seg2
        color = C_GOLD_L if tag else C_WHITE
        text(slide, bx, top2 + 520000, seg2 - gutter, 260000,
             [[(name, 10.5, color, True)]])
        text(slide, bx, top2 + 800000, seg2 - gutter, 520000,
             [[(note, 9.5, C_SUB)]])
        if i < len(flow_good) - 1:
            arrow(slide, bx + seg2 - gutter, top2 + 520000, gutter, 700000, size=15)
    text(slide, MARGIN + 220000, top2 + 1330000, CONTENT_W - 440000, 320000,
         [[("讀法很簡單：帶 request 的是「還沒發生，請你做」；不帶的是「已經發生了，給你知道」。", 10, C_SUB)]])

    takeaway(slide, top2 + h_row2 + 260000,
             "唯一安全的例外：wallet 的 ReadSyncListener 確實會消費這兩個事件，"
             "但它只寫 MySQL 讀視圖、從不回頭呼叫入帳方法 —— 這條線寫進了專案規範，新增消費者一律照這個模式。")
    return slide


def slide_kafka_delivery(prs):
    slide = new_slide(prs)
    header(slide, "事件驅動架構・04／05",
           "送得出去，也要收得下來",
           "事件不能在網路失敗時無聲消失，也不能因為重送就把帳算兩次",
           "幸運星幣城｜Outbox 與冪等消費")

    gap = 260000
    w = (CONTENT_W - gap) // 2
    top = Y_CONTENT
    h = 3350000
    item_gap = 900000

    inner = card(slide, MARGIN, top, w, h, "發送端：Transactional Outbox",
                 "事件跟帳務寫在同一個交易裡")
    left_items = [
        ("同一個交易，要嘛都成功", "帳務寫 wallet_transactions 的同時，事件寫進 wallet_outbox；一起 commit、一起 rollback"),
        ("Poller 確認送達才標 SENT", "排程撈 PENDING 送 Kafka，等 broker 回覆（最多 10 秒）才把狀態改掉"),
        ("舊寫法錯在哪", "commit 之後才裸發 Kafka，broker 掛掉發生在背景執行緒，連一行 log 都沒有 —— 事件無聲消失"),
    ]
    cur = inner + 40000
    for name, note in left_items:
        text(slide, MARGIN + 160000, cur, w - 320000, 240000,
             [[("・" + name, 11, C_GOLD_L, True)]])
        text(slide, MARGIN + 300000, cur + 250000, w - 460000, 560000,
             [[(note, 9.5, C_SUB)]])
        cur += item_gap

    x2 = MARGIN + w + gap
    inner2 = card(slide, x2, top, w, h, "消費端：at-least-once 的代價",
                  "同一則事件一定會有重送的一天", bar=C_PANEL2)
    right_items = [
        ("冪等寫入 → 可以安全重放", "讀視圖先 existsById 再寫；排行榜用 ZADD 寫入絕對值 —— 重做幾次結果都一樣"),
        ("非冪等累加 → 必須去重", "每日贏分是 ZINCRBY，重做就多加一次；用 Redis SETNX 記住 transactionId 擋掉"),
        ("判準只有一句話", "問「這個操作重做一次會不會出事」；不會就別加去重，加了反而可能把值卡在錯的中間態"),
    ]
    cur = inner2 + 40000
    for name, note in right_items:
        text(slide, x2 + 160000, cur, w - 320000, 240000,
             [[("・" + name, 11, C_GOLD_L, True)]])
        text(slide, x2 + 300000, cur + 250000, w - 460000, 560000,
             [[(note, 9.5, C_SUB)]])
        cur += item_gap

    takeaway(slide, top + h + 240000,
             "Kafka 只保證「至少送一次」，不保證「剛好一次」——"
             "剛好一次是消費端自己做出來的，不是 broker 給的。",
             fill=C_PANEL2, h=470000)
    return slide


def slide_kafka_dlt(prs):
    slide = new_slide(prs)
    header(slide, "事件驅動架構・05／05",
           "一則壞訊息，不能卡住後面所有人的帳",
           "同一個 partition 是排隊處理的：第一則卡住不放行，後面的訊息永遠消費不到",
           "幸運星幣城｜死信佇列與人工重送")

    steps = [
        ("1", "消費失敗", "payload 壞掉、下游暫時不通，listener 直接把例外往上拋", "不吞例外"),
        ("2", "自動重試", "統一的錯誤處理器每隔 2 秒重試，最多 3 次", "2 秒 × 3 次"),
        ("3", "送進 DLT", "仍失敗就搬到 <原 topic>.DLT，offset 往前走，後面的訊息繼續跑", "隊伍不卡住"),
        ("4", "收容成單據", "DLT listener 把訊息寫進 dead_letter_messages，含原 topic、key、payload", "留下可查的紀錄"),
        ("5", "查詢與重送", "後台可以查、修好資料後用原本的 key 重送回原 topic", "冪等鍵擋掉重複"),
    ]
    n = len(steps)
    gap = 150000
    w = (CONTENT_W - gap * (n - 1)) // n
    top = Y_CONTENT + 60000
    h = 3150000

    for i, (num, name, note, tag) in enumerate(steps):
        x = MARGIN + i * (w + gap)
        box(slide, x, top, w, h, fill=C_PANEL, shape=MSO_SHAPE.ROUNDED_RECTANGLE)
        box(slide, x + (w - 500000) // 2, top + 320000, 500000, 500000, fill=C_GOLD,
            shape=MSO_SHAPE.OVAL)
        text(slide, x + (w - 500000) // 2, top + 320000, 500000, 500000,
             [[(num, 16, C_INK, True)]], align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)
        text(slide, x + 120000, top + 990000, w - 240000, 320000,
             [[(name, 12.5, C_WHITE, True)]], align=PP_ALIGN.CENTER)
        text(slide, x + 150000, top + 1420000, w - 300000, 1500000,
             [[(note, 10, C_SUB)]], align=PP_ALIGN.CENTER)
        box(slide, x + 130000, top + h - 560000, w - 260000, 420000, fill=C_PANEL2,
            shape=MSO_SHAPE.ROUNDED_RECTANGLE)
        text(slide, x + 130000, top + h - 560000, w - 260000, 420000,
             [[(tag, 10, C_GOLD_L, True)]], align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)
        if i < n - 1:
            arrow(slide, x + w, top + 400000, gap, 360000, size=16)

    takeaway(slide, top + h + 240000,
             "換來的東西很具體：壞資料變成一張「可以查、可以重送」的單據，"
             "而不是一條停在那裡、沒人知道的隊伍。",
             fill=C_PANEL2, h=500000)
    return slide


# --------------------------------------------------------------------------
# C. CQRS 合併版
# --------------------------------------------------------------------------
def slide_cqrs(prs):
    slide = new_slide(prs)
    header(slide, "資料層設計・ADR-001",
           "為什麼要兩個資料庫？寫的歸 PostgreSQL，查的歸 MySQL",
           "帳務寫入要 ACID；查詢流量再大，也不能拖垮下注這條路",
           "幸運星幣城｜雙資料庫 CQRS")

    col_w = 3360000
    arrow_w = 500000
    top = Y_CONTENT
    h = 3350000
    xs = [MARGIN, MARGIN + col_w + arrow_w, MARGIN + 2 * (col_w + arrow_w)]

    cols = [
        ("PostgreSQL ─ 帳務寫庫", "單一真相・交易一致性", C_GOLD, [
            ("wallets", "balance ＋ version 樂觀鎖：防超扣"),
            ("wallet_transactions", "idempotency_key UNIQUE：防重複入帳"),
            ("wallet_outbox", "事件與帳務同一交易，不會只成功一半"),
        ]),
        ("Kafka ─ 事件管道", "at-least-once・非同步", C_PANEL2, [
            ("wallet.credit / wallet.debit", "餘額一有變動就發事件出去"),
            ("OutboxPoller", "撈 PENDING，確認送達才標 SENT"),
            ("下游各自訂閱", "讀庫同步、排行榜、後台報表互不干擾"),
        ]),
        ("MySQL ─ 查詢讀庫", "最終一致・只讀不寫", C_GOLD, [
            ("wallet_transaction_view", "沿用寫庫 id，重放也不會多一筆"),
            ("ReadSyncListener", "existsById 冪等檢查，可安全重放"),
            ("誰在用", "交易分頁、後台流通量／RTP 報表、對帳"),
        ]),
    ]

    for i, (title_, sub, bar, rows) in enumerate(cols):
        x = xs[i]
        inner = card(slide, x, top, col_w, h, title_, sub, bar=bar)
        cur = inner + 60000
        for name, note in rows:
            text(slide, x + 160000, cur, col_w - 320000, 250000,
                 [[(name, 10.5, C_GOLD_L, True)]])
            text(slide, x + 160000, cur + 260000, col_w - 320000, 500000,
                 [[(note, 9.5, C_SUB)]])
            cur += 900000
        if i < 2:
            arrow(slide, x + col_w, top + h / 2 - 250000, arrow_w, 500000, size=22)

    takeaway(slide, top + h + 240000,
             "代價是讀庫會晚幾百毫秒 —— 我們接受：查詢晚一點沒關係，帳算錯不行。"
             "就算查詢把讀庫打爆，玩家照樣可以下注。",
             fill=C_PANEL2, h=500000)
    return slide


# --------------------------------------------------------------------------
# D. AI 協作 ×4
# --------------------------------------------------------------------------
def slide_ai_setup(prs):
    slide = new_slide(prs)
    header(slide, "AI 協作・01／04",
           "兩套 AI 工具，一套規範",
           "工具可以換，規範不能換 —— 收斂點放在 repo 裡，不是放在各自的對話視窗裡",
           "幸運星幣城｜AI 協作架構")

    gap = 220000
    w = (CONTENT_W - gap * 2) // 3
    top = Y_CONTENT
    h = 3200000

    cols = [
        ("Claude Code", "CLI 代理・直接讀專案檔", C_GOLD, [
            "跨檔實作與重構：一次動好幾個服務也保持一致",
            "會自己讀 AGENTS.md、ADR、既有程式碼再動手",
            "能直接跑 mvn test / npm test，紅燈當場修",
        ]),
        ("Codex", "另一位組員的主力工具", C_GOLD, [
            "同一份規範下獨立產出，不共用對話脈絡",
            "負責自己那幾個服務與工具腳本",
            "產出一樣要走 PR 與 CI，沒有例外通道",
        ]),
        ("人負責什麼", "AI 不做決定的部分", C_PANEL2, [
            "需求切分：把大題目拆成一次一個關卡",
            "架構拍板：寫成 ADR，AI 照著做而不是自己選",
            "PR review 與最終驗收：紅燈不合、看不懂就退回",
        ]),
    ]

    for i, (name, sub, bar, items) in enumerate(cols):
        x = MARGIN + i * (w + gap)
        inner = card(slide, x, top, w, h, name, sub, bar=bar)
        cur = inner + 80000
        for it in items:
            text(slide, x + 160000, cur, w - 320000, 700000,
                 [[("・" + it, 11, C_BODY)]])
            cur += 800000

    takeaway(slide, top + h + 260000,
             "組員各用一套工具、各自負責不同服務，靠 AGENTS.md／CLAUDE.md／ADR 收斂 ——"
             "結果是不同工具寫出來的程式碼，看起來像同一個團隊寫的。",
             fill=C_PANEL2, h=520000)
    return slide


def slide_ai_howto(prs):
    slide = new_slide(prs)
    header(slide, "AI 協作・02／04",
           "怎麼讓 AI 產出我們要的：先把規則寫死",
           "提示詞寫得再漂亮，都不如把約束放進 repo，讓它每一次都被迫讀到",
           "幸運星幣城｜讓 AI 照專案規則走")

    gap = 200000
    w = (CONTENT_W - gap * 3) // 4
    top = Y_CONTENT
    h = 3250000

    cols = [
        ("① 規範先行", "AGENTS.md", [
            ("31 條專案雷區", "每一條都是實際踩過的坑：改 A 要同步改 B、哪個寫法會無限迴圈"),
            ("必讀文件順序", "動工前先讀哪五份文件，寫得明明白白"),
        ]),
        ("② 架構先拍板", "12 篇 ADR", [
            ("先決定再實作", "為什麼選這個、放棄了什麼，白紙黑字"),
            ("AI 不自己選架構", "遇到架構級選擇要先問，不能自作主張"),
        ]),
        ("③ 任務切小", "一次一個關卡", [
            ("單一職責的任務", "一次一個服務、一個功能，不讓它一口氣改十個檔"),
            ("角色分開", "實作、寫測試、code review 分開跑；寫的人不審自己的碼"),
        ]),
        ("④ 契約當真相", "contracts/*.json", [
            ("玩法數值單一來源", "5 份契約檔，前端 mock 直接讀，不各寫一份"),
            ("漂移就紅燈", "ContractParityTest 逐欄比對後端常數與契約檔"),
        ]),
    ]

    for i, (name, sub, items) in enumerate(cols):
        x = MARGIN + i * (w + gap)
        inner = card(slide, x, top, w, h, name, sub)
        cur = inner + 60000
        for t, note in items:
            text(slide, x + 150000, cur, w - 300000, 250000,
                 [[(t, 10.5, C_GOLD_L, True)]])
            text(slide, x + 150000, cur + 260000, w - 300000, 900000,
                 [[(note, 9.5, C_SUB)]])
            cur += 1100000

    takeaway(slide, top + h + 260000,
             "規範寫在 repo 裡而不是對話裡的好處：換一個對話、換一套工具、換一個組員，"
             "讀到的都是同一份約束 —— 這也是兩套 AI 工具能併存的原因。",
             fill=C_PANEL2, h=500000)
    return slide


def slide_ai_gate(prs):
    slide = new_slide(prs)
    header(slide, "AI 協作・03／04",
           "AI 寫的程式碼，一樣要過三道機械關卡",
           "我們不相信「看起來對」，只相信「跑起來是綠的」",
           "幸運星幣城｜AI 產出的把關機制")

    gap = 240000
    w = (CONTENT_W - gap * 2) // 3
    top = Y_CONTENT
    h = 3250000

    cols = [
        ("關卡一・人審 PR", "沒有直推 main 這條路", [
            "feature 分支 → PR → develop，main 受保護",
            "每個 PR 至少一人 review，看不懂就要求解釋",
            "改了行為就要在 CHANGELOG 寫「為什麼」與「怎麼驗證」",
        ]),
        ("關卡二・CI 三道 job", "提交就跑，不用等人想起來", [
            "基礎設施測試：Kafka topic 清單、環境腳本",
            "後端七服務測試：H2 零依賴，另跑 Testcontainers 真 DB",
            "前端品質關卡：lint → vitest → build → Playwright 版面回歸",
        ]),
        ("關卡三・契約與帳務 gate", "數字對不上就紅燈", [
            "ContractParityTest：後端常數 ↔ 契約檔逐欄比對",
            "壓測跑完自動對帳：九項 SQL 檢查帳務不變量",
            "全部輪次結果：超扣 0 筆、重複入帳 0 筆",
        ]),
    ]

    for i, (name, sub, items) in enumerate(cols):
        x = MARGIN + i * (w + gap)
        inner = card(slide, x, top, w, h, name, sub, bar=C_GOLD if i < 2 else C_PANEL2)
        cur = inner + 100000
        for it in items:
            text(slide, x + 160000, cur, w - 320000, 760000,
                 [[("・" + it, 11, C_BODY)]])
            cur += 860000

    takeaway(slide, top + h + 260000,
             "AI 讓「產出」變快，人的角色就往前移到「訂規則」與「把關」——"
             "這三道關卡不會因為碼是誰寫的而放寬。",
             fill=C_PANEL2, h=500000)
    return slide


def slide_ai_cases(prs):
    slide = new_slide(prs)
    header(slide, "AI 協作・04／04",
           "三次教訓：測試全綠，不等於程式是對的",
           "每一次踩雷，最後都變成「一條規範 ＋ 一個機械守門」",
           "幸運星幣城｜AI 產出的三個真實案例")

    gap = 240000
    w = (CONTENT_W - gap * 2) // 3
    top = Y_CONTENT - 40000
    h = 3400000

    cases = [
        ("案例一・大魚永遠打不死", [
            ("現象", "捕魚機的大魚血量每一批都回滿，怎麼打都打不死"),
            ("根因", "Redis session 漏存累積傷害欄位；而單元測試把整個 store mock 掉了，所以測試全綠"),
            ("修正", "寫進專案雷區，並補一支專測序列化的測試守門"),
        ]),
        ("案例二・百家樂玩家永遠輸", [
            ("現象", "風控每一局都判定超過回報率上限，把結果強制改判成莊家贏"),
            ("根因", "全域 RTP 門檻訂得比百家樂本身的結構性 RTP（約 0.99）還低"),
            ("修正", "門檻改成逐遊戲設定，且必須高於該遊戲結構性 RTP，寫進雷區"),
        ]),
        ("案例三・全螢幕版面壞三次", [
            ("現象", "按鍵被蓋住、轉輪被裁掉、版面整個位移，前後發生三次"),
            ("根因", "三次同一個根因：容器用固定列數的 grid，子元素一隱藏就整個位移"),
            ("修正", "改成 flex「主角吃剩餘空間」，並用真瀏覽器量測做回歸測試"),
        ]),
    ]

    for i, (name, rows) in enumerate(cases):
        x = MARGIN + i * (w + gap)
        inner = card(slide, x, top, w, h, name, bar=C_GOLD if i != 1 else C_WARN)
        cur = inner + 60000
        for label, note in rows:
            box(slide, x + 150000, cur, 380000, 230000,
                fill=C_PANEL2, shape=MSO_SHAPE.ROUNDED_RECTANGLE)
            text(slide, x + 150000, cur, 380000, 230000,
                 [[(label, 9, C_GOLD_L, True)]], align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)
            text(slide, x + 150000, cur + 280000, w - 300000, 700000,
                 [[(note, 10, C_BODY)]])
            cur += 980000

    takeaway(slide, top + h + 240000,
             "三個案例的共同點：AI 產出的程式碼都通過了「當時的測試」——"
             "缺的不是 AI 的能力，是我們的守門條件還不夠。",
             fill=C_PANEL2, h=470000)
    return slide


# --------------------------------------------------------------------------
# 備忘稿（只給 Kafka 那 5 頁）
# --------------------------------------------------------------------------
KAFKA_NOTES = [
    # 01 全景
    "這一段是我們架構上最想講的部分：服務之間怎麼不互相綁死。\n"
    "整個系統有 8 條業務事件流。重點不是數量，是「發送的人不需要知道誰在收」——"
    "game-service 發出 game.result 之後就結束了，排行榜、推播、後台報表各自訂閱，"
    "今天要多一個消費者，發送端一行都不用改。\n"
    "右上角的 partition 數是刻意配的：下注派彩這種每一局都會觸發的給 6 個，"
    "註冊、好友異動這種很少發生的給 3 個。\n"
    "另外所有 producer 都用 playerId 當 key，所以同一個玩家的事件一定落在同一個 partition，"
    "順序保證不會亂 —— 這件事對帳務很重要。",
    # 02 為什麼
    "為什麼要多一層 Kafka？因為下注這條路上，每多做一件事，單機能扛的人就少一點。\n"
    "左邊是我們判定「非同步不可」的部分：驗證、算局、扣款、落帳，這幾件事錯了就要當場拒絕玩家，"
    "所以必須同步做完才回應。\n"
    "右邊這五件事晚個幾秒沒有人會發現：排行榜名次、交易紀錄分頁、推播、後台報表。"
    "全部丟給 Kafka。\n"
    "這個取捨是有數字的：我們實測全鏈路單機大約 200 req/s，"
    "最後量到的瓶頸是資料庫交易容量、大約 575 tx/s，而不是事件管道 —— "
    "代表這一層拆對了。",
    # 03 指令 vs 事件
    "這一頁是我們踩過的坑，也是寫成 ADR 的原因。\n"
    "上面那條是反例：如果只有一個 wallet.credit，錢包入帳完發出事件，"
    "自己的 listener 又收到、又去入帳一次，就變成無限迴圈，餘額會一直長大。\n"
    "所以我們把它拆成兩個 topic：帶 request 的是「指令」，意思是請你幫我入帳，由會員服務發出；"
    "不帶 request 的是「事件」，意思是已經入帳完成了，由錢包服務發出，給排行榜、讀庫、後台訂閱。\n"
    "一個字的差別，但語意完全不同：一個是還沒發生、一個是已經發生。\n"
    "唯一的例外寫在最下面：錢包自己有一個 listener 確實會收這兩個事件，"
    "但它只寫查詢用的讀視圖，絕對不會回頭呼叫入帳 —— 這條規則我們寫進專案規範，新增消費者都要照這個模式。",
    # 04 Outbox / 冪等
    "事件驅動最怕兩件事：該送的沒送出去，以及送太多次被算兩次。\n"
    "左邊解決第一件。我們把事件跟帳務寫在同一個資料庫交易裡，要嘛都成功、要嘛都回滾；"
    "再由排程去撈還沒送出的，等 Kafka 真的回覆確認才標記完成。\n"
    "舊的寫法是交易 commit 之後才發 Kafka，如果 broker 剛好掛掉，那是背景執行緒的事，"
    "連一行 log 都不會印 —— 事件就這樣無聲消失，下游三個地方同時開始漂移，而且沒人知道。\n"
    "右邊解決第二件。Kafka 保證的是「至少送一次」，所以重送一定會發生。\n"
    "我們的判準只有一句話：這個操作重做一次會不會出事。寫絕對值的可以直接重放；"
    "像每日贏分那種累加的，就用 Redis 記住交易編號擋掉重複。\n"
    "所以「剛好一次」不是 Kafka 給的，是消費端自己做出來的。",
    # 05 DLT
    "最後一頁講失敗。Kafka 同一個 partition 是排隊處理的，"
    "如果第一則訊息壞掉又一直重試，後面所有訊息就永遠消費不到 —— 整條線就停在那裡。\n"
    "我們的做法是：失敗先自動重試，每兩秒一次、最多三次；"
    "還是失敗就把它搬到對應的死信 topic，讓 offset 往前走，正常訊息繼續跑。\n"
    "然後錢包服務有一個 listener 專門收這些死信，寫成資料表的一筆紀錄，"
    "包含原本的 topic、key 和完整內容。後台可以查，資料修好之後用原本的 key 重送回原 topic。\n"
    "換來的東西很具體：壞資料變成一張可以查、可以重送的單據，"
    "而不是一條停在那裡、而且沒有人知道的隊伍。",
]


def set_notes(slide, text_):
    slide.notes_slide.notes_text_frame.text = text_


# --------------------------------------------------------------------------
# 主流程：新增頁面 → 重排 → 刪除重複頁 → 存檔
# --------------------------------------------------------------------------
def main(src, dst):
    prs = Presentation(src)
    sld_lst = prs.slides._sldIdLst
    original = list(sld_lst)
    n_orig = len(original)
    if n_orig != 58:
        print("[warn] 來源簡報有 %d 頁，本腳本是針對 58 頁的版本寫的，索引可能對不上" % n_orig)

    # --- 產生新頁（python-pptx 一律 append 在最後） ---
    er_pg = slide_er_pg(prs)
    er_my = slide_er_mysql(prs)
    cqrs = slide_cqrs(prs)
    k1 = slide_kafka_overview(prs)
    k2 = slide_kafka_why(prs)
    k3 = slide_kafka_command_event(prs)
    k4 = slide_kafka_delivery(prs)
    k5 = slide_kafka_dlt(prs)
    ai1 = slide_ai_setup(prs)
    ai2 = slide_ai_howto(prs)
    ai3 = slide_ai_gate(prs)
    ai4 = slide_ai_cases(prs)

    for slide, note in zip([k1, k2, k3, k4, k5], KAFKA_NOTES):
        set_notes(slide, note)

    after = list(sld_lst)
    new_elems = after[n_orig:]          # 12 個新頁的 sldId 元素，順序同上面建立順序
    (e_er_pg, e_er_my, e_cqrs, e_k1, e_k2, e_k3, e_k4, e_k5,
     e_ai1, e_ai2, e_ai3, e_ai4) = new_elems

    def o(n):
        """用原始的 1-based 頁碼取元素。"""
        return original[n - 1]

    # --- 目標順序 ---
    # 1,2 → ER 精簡 ×2 → 6..23 → CQRS 合併 → 25..29 → Kafka ×5
    # → 31..54 → AI ×4 → 55..57 → 原 ER 完整版 3,4,5（附錄）→ 58 謝謝聆聽
    order = (
        [o(1), o(2), e_er_pg, e_er_my]
        + [o(i) for i in range(6, 24)]
        + [e_cqrs]
        + [o(i) for i in range(25, 30)]
        + [e_k1, e_k2, e_k3, e_k4, e_k5]
        + [o(i) for i in range(31, 55)]
        + [e_ai1, e_ai2, e_ai3, e_ai4]
        + [o(i) for i in range(55, 58)]
        + [o(3), o(4), o(5)]
        + [o(58)]
    )

    dropped = [o(24), o(30)]            # 兩頁重複的 CQRS

    assert len(order) == n_orig - len(dropped) + len(new_elems), "頁面總數對不上"
    assert len(set(id(x) for x in order)) == len(order), "有頁面重複出現"

    # 先把要丟掉的頁面連同關聯一起移除，避免留下孤兒 part
    for el in dropped:
        prs.part.drop_rel(el.rId)

    # 重排：把所有元素抽出來，再照 order 逐一放回去
    for el in list(sld_lst):
        sld_lst.remove(el)
    for el in order:
        sld_lst.append(el)

    prs.save(dst)
    print("已輸出：%s（%d 頁）" % (dst, len(list(sld_lst))))


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print(__doc__)
        sys.exit(1)
    main(sys.argv[1], sys.argv[2])
