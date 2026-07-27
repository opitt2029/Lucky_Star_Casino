#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""產生「架構總覽版」ER 圖（節點連線式，共 2 頁，16:9 投影片尺寸）。

跟 `generate-er-executive.py` 的差別
-----------------------------------
`generate-er-executive.py` 產生的是**卡片清單版**：一張表一張卡，適合逐項讀說明。
本腳本產生的是**節點連線版**：一張表一個方塊，用線把關聯連起來，並用
crow's foot（雞爪）符號標「一對一 / 一對多」。適合投影片上一眼看見整體長相。

兩種版型互補，都保留：
  - 想「逐表讀懂用途」→ 看董事長版（卡片）
  - 想「一眼看關聯全貌」→ 看本檔產出的架構總覽版

版面尺寸
--------
畫布固定 1280×720，正好是 16:9 投影片（13.33in × 7.5in）的等比座標系，
換算下來 1 個 SVG 單位 = 0.75pt，所以下面所有字級乘以 0.75 就是投影片上的 pt 數。
主角是 ER 圖本身：節點名 21（≈15.75pt）刻意大於頁面標題 20（15pt）。
圖形區還會**自動縮放置中**撐滿版面，表數較少的第 2 頁因此字會更大。

執行
----
    python docs/assets/er/generate-er-graph.py

輸出（覆寫，每頁淺色 / 深色各一張，共 4 張）
--------------------------------------------
    er-架構總覽-1-帳務與遊戲.svg / -深色.svg      第 1 頁：PostgreSQL 帳務寫庫（16 張表）
    er-架構總覽-2-會員與營運.svg / -深色.svg      第 2 頁：MySQL 查詢讀庫（13 張表）

資料來源：`database/postgres/init.sql`、`database/mysql/init.sql`
（schema 有變動時，先更新 `注解-*.md`，再改本檔第 6、7 節的資料區）。
"""

from math import hypot
from pathlib import Path

# ---------------------------------------------------------------------------
# 1. 配色
# ---------------------------------------------------------------------------

FONT = ("'Microsoft JhengHei','Microsoft YaHei','PingFang TC','Noto Sans TC',"
        "'Heiti TC','Segoe UI Emoji',-apple-system,sans-serif")
MONO = "'Consolas','Menlo','Courier New',monospace"

# 深色版不是把淺色調亮就好——暗底上的深色（#B45309）幾乎看不見，
# 所以整組換成明度更高的色，方塊底色則改用「帶色調的暗面」。
PALETTES = {
    "light": {
        "CANVAS": "#FFFFFF",
        "INK": "#0F172A",
        "INK_SUB": "#475569",
        "INK_MUTE": "#94A3B8",
        "RULE": "#CBD5E1",         # 標題下方分隔線
        "MODULE_BG": "#F1F5F9",    # 模組灰框
        "MODULE_FG": "#334155",
        "NODE_BG": "#FFFFFF",
        "LINE": "#64748B",         # 關聯線
        "LINE_DIM": "#A8B4C4",     # 跨庫虛線
        "PANEL_BG": "#F8FAFC",     # 圖例底
        "PANEL_BORDER": "#E2E8F0",
        # 類型色：(線框與文字色, 方塊底色)
        "TYPE": {
            "money":  ("#B45309", "#FEF6E3"),
            "game":   ("#6D28D9", "#F1ECFE"),
            "member": ("#4338CA", "#EAEDFE"),
            "quest":  ("#047857", "#E3F6EE"),
            "stat":   ("#0369A1", "#E7F4FD"),
            "admin":  ("#BE123C", "#FEECEF"),
            "sys":    ("#0F766E", "#E3F7F4"),
        },
    },
    "dark": {
        "CANVAS": "#0B0F17",
        "INK": "#F1F5F9",
        "INK_SUB": "#AEBACB",
        "INK_MUTE": "#8496AE",
        "RULE": "#39445A",
        "MODULE_BG": "#171E2B",
        "MODULE_FG": "#D5DEEC",
        "NODE_BG": "#131A26",
        "LINE": "#8D9BB0",
        "LINE_DIM": "#5B6880",
        "PANEL_BG": "#131A26",
        "PANEL_BORDER": "#2C3648",
        "TYPE": {
            "money":  ("#FBBF24", "#2A2008"),
            "game":   ("#A78BFA", "#1E1638"),
            "member": ("#8B95FA", "#181B3C"),
            "quest":  ("#34D399", "#08281E"),
            "stat":   ("#38BDF8", "#082436"),
            "admin":  ("#FB7185", "#2C0F1B"),
            "sys":    ("#2DD4BF", "#072B27"),
        },
    },
}

# 圖例文字（順序＝圖例顯示順序）
TYPE_LABELS = [
    ("money",  "金流／錢包"),
    ("game",   "遊戲"),
    ("member", "會員／身分"),
    ("quest",  "任務／活動"),
    ("stat",   "排行／統計"),
    ("admin",  "後台／風控"),
    ("sys",    "系統共用"),
]


def use_theme(mode):
    """切換配色：把該套色票攤平成模組層變數，繪圖函式就不必多接一個參數。

    本檔是單執行緒、一次性執行的腳本，用全域變數安全且讀起來最短。
    """
    global CANVAS, INK, INK_SUB, INK_MUTE, RULE, MODULE_BG, MODULE_FG
    global NODE_BG, LINE, LINE_DIM, PANEL_BG, PANEL_BORDER, TYPE
    p = PALETTES[mode]
    CANVAS, INK, INK_SUB = p["CANVAS"], p["INK"], p["INK_SUB"]
    INK_MUTE, RULE = p["INK_MUTE"], p["RULE"]
    MODULE_BG, MODULE_FG = p["MODULE_BG"], p["MODULE_FG"]
    NODE_BG, LINE, LINE_DIM = p["NODE_BG"], p["LINE"], p["LINE_DIM"]
    PANEL_BG, PANEL_BORDER = p["PANEL_BG"], p["PANEL_BORDER"]
    TYPE = p["TYPE"]


use_theme("dark")


# ---------------------------------------------------------------------------
# 2. 版面尺寸
# ---------------------------------------------------------------------------

W, H = 1280, 720    # 16:9，對應 13.33in × 7.5in 投影片
NODE_W, NODE_H = 170, 50
# 欄／列間距同時是「走線通道」的寬高，也要塞得下線上的關係說明文字，
# 所以留得比看起來需要的更寬——太窄的話標籤會壓到旁邊的方塊。
COL_GAP, ROW_GAP = 78, 64
ROW_TOP = 84
MOD_PAD = 11        # 模組灰框的上／左／右內距
MOD_PAD_B = 24      # 下內距（要放得下模組標題）
PORT_SPREAD = 0.62  # 同一邊多條線時，連接點分散佔邊長的比例

# 圖形區：頁首之下、圖例之上。內容會自動等比縮放置中塞滿這塊。
DIAG = (46, 74, 1234, 616)      # (x0, y0, x1, y1)
LEGEND_Y, LEGEND_H = 626, 58
FIT_MAX = 1.65      # 縮放上限，免得表少的那頁被放大到失衡


def grid(n_cols, n_rows):
    """算出每一格的左上角座標。整組格線先水平置中，之後再由自動縮放微調。"""
    total = n_cols * NODE_W + (n_cols - 1) * COL_GAP
    left = (W - total) / 2
    col_x = [left + i * (NODE_W + COL_GAP) for i in range(n_cols)]
    row_y = [ROW_TOP + j * (NODE_H + ROW_GAP) for j in range(n_rows)]
    return col_x, row_y


# ---------------------------------------------------------------------------
# 3. 低階繪圖工具
# ---------------------------------------------------------------------------

def esc(s):
    """XML escape。SVG 是 XML，& < > 一定要跳脫，否則整張圖打不開。"""
    return str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def est_width(s, size):
    """粗估字串像素寬：中日韓字元約等於字級，半形字元約 0.55 倍。

    只用來決定標籤底色要多寬，估錯一點點不影響閱讀。
    """
    return sum(size if ord(ch) > 0x2E7F else size * 0.55 for ch in s)


def f(v):
    """座標轉字串：去掉多餘小數，SVG 檔會小一點也好讀。"""
    return f"{v:.1f}".rstrip("0").rstrip(".")


def rect(x, y, w, h, fill, rx=8, stroke=None, sw=1, dash=None):
    st = f' stroke="{stroke}" stroke-width="{sw}"' if stroke else ""
    da = f' stroke-dasharray="{dash}"' if dash else ""
    return (f'<rect x="{f(x)}" y="{f(y)}" width="{f(w)}" height="{f(h)}" '
            f'rx="{rx}" fill="{fill}"{st}{da}/>')


def txt(x, y, s, size=11, fill=None, weight="normal", anchor="start",
        family=None):
    # 預設色必須在呼叫當下才取 INK，不能寫成參數預設值——
    # 參數預設值在函式定義時就固定了，use_theme() 之後換不掉。
    fill = fill or INK
    return (f'<text x="{f(x)}" y="{f(y)}" font-family="{family or FONT}" '
            f'font-size="{size}" fill="{fill}" font-weight="{weight}" '
            f'text-anchor="{anchor}">{esc(s)}</text>')


def path(d, stroke, sw=1.4, dash=None):
    da = f' stroke-dasharray="{dash}"' if dash else ""
    return (f'<path d="{d}" fill="none" stroke="{stroke}" stroke-width="{sw}" '
            f'stroke-linecap="round" stroke-linejoin="round"{da}/>')


def dedupe(pts):
    """去掉重複點與「走了等於沒走」的共線中間點，避免圓角演算法出怪形狀。"""
    out = []
    for p in pts:
        if not out or hypot(p[0] - out[-1][0], p[1] - out[-1][1]) > 0.5:
            out.append(p)
    i = 1
    while i < len(out) - 1:
        (x0, y0), (x1, y1), (x2, y2) = out[i - 1], out[i], out[i + 1]
        # 三點同在一條水平線或垂直線上 → 中間點多餘
        if (abs(y0 - y1) < 0.5 and abs(y1 - y2) < 0.5) or \
           (abs(x0 - x1) < 0.5 and abs(x1 - x2) < 0.5):
            out.pop(i)
        else:
            i += 1
    return out


def rounded_path(pts, r=10):
    """把折線轉成「轉角有圓弧」的 SVG path。直角轉折看起來太硬，圓角好讀。"""
    pts = dedupe(pts)
    if len(pts) < 2:
        return ""
    d = [f"M{f(pts[0][0])},{f(pts[0][1])}"]
    for i in range(1, len(pts) - 1):
        (x0, y0), (x1, y1), (x2, y2) = pts[i - 1], pts[i], pts[i + 1]
        d1, d2 = hypot(x1 - x0, y1 - y0), hypot(x2 - x1, y2 - y1)
        if d1 == 0 or d2 == 0:
            continue
        # 圓角半徑不能超過任一邊的一半，否則相鄰兩個轉角會互相吃掉
        rr = min(r, d1 / 2, d2 / 2)
        ax, ay = x1 - (x1 - x0) / d1 * rr, y1 - (y1 - y0) / d1 * rr
        bx, by = x1 + (x2 - x1) / d2 * rr, y1 + (y2 - y1) / d2 * rr
        d.append(f"L{f(ax)},{f(ay)}")
        d.append(f"Q{f(x1)},{f(y1)} {f(bx)},{f(by)}")
    d.append(f"L{f(pts[-1][0])},{f(pts[-1][1])}")
    return " ".join(d)


# ---------------------------------------------------------------------------
# 4. crow's foot（雞爪）符號
# ---------------------------------------------------------------------------
# ER 圖的標準記法，畫在線的兩端，讀作「這一端有幾筆」：
#   one       ─┤    剛好一筆
#   many      ─<    多筆
#   zero_one  ─o┤   零筆或一筆（可能沒有）
#   zero_many ─o<   零筆或多筆（可能一筆都沒有）

def crow(px, py, dx, dy, kind, color):
    """在端點 (px,py) 畫雞爪。(dx,dy) 是單位向量，方向為「線 → 方塊」。"""
    if not kind:
        return ""
    ux, uy = -dx, -dy          # 由端點往回（遠離方塊）的方向
    nx, ny = -dy, dx           # 垂直方向
    out = []

    def tick(dist, half):
        cx, cy = px + ux * dist, py + uy * dist
        return path(f"M{f(cx - nx * half)},{f(cy - ny * half)} "
                    f"L{f(cx + nx * half)},{f(cy + ny * half)}", color, 1.6)

    def foot(dist):
        # 爪尖貼著方塊、爪柄往外，三根線從同一點散開
        ax, ay = px + ux * dist, py + uy * dist
        return "".join(
            path(f"M{f(ax)},{f(ay)} L{f(px + nx * h)},{f(py + ny * h)}",
                 color, 1.5)
            for h in (-6.5, 0, 6.5))

    if kind == "one":
        out.append(tick(7, 7))
    elif kind == "many":
        out.append(foot(13))
    elif kind == "zero_one":
        out.append(tick(8, 7))
        out.append(f'<circle cx="{f(px + ux * 17)}" cy="{f(py + uy * 17)}" '
                   f'r="3.6" fill="{CANVAS}" stroke="{color}" '
                   f'stroke-width="1.5"/>')
    elif kind == "zero_many":
        out.append(foot(13))
        out.append(f'<circle cx="{f(px + ux * 20)}" cy="{f(py + uy * 20)}" '
                   f'r="3.6" fill="{CANVAS}" stroke="{color}" '
                   f'stroke-width="1.5"/>')
    return "".join(out)


# ---------------------------------------------------------------------------
# 5. 版面組裝：方塊 / 模組框 / 連線 / 頁首 / 圖例
# ---------------------------------------------------------------------------

class Page:
    """一頁圖。負責放方塊、算走線、輸出 SVG。

    座標系統用「格子」思考：節點只給 (col, row)，實際像素由 grid() 算。
    走線則沿著格子之間的空白通道跑——垂直通道叫 gutter、水平通道叫 channel，
    通道裡一定沒有方塊，所以線不會壓到字。
    """

    def __init__(self, n_cols, n_rows):
        self.col_x, self.row_y = grid(n_cols, n_rows)
        self.n_cols, self.n_rows = n_cols, n_rows
        self.nodes = {}        # id -> dict
        self.modules = []
        self.edges = []
        self._lane = {}        # 通道使用次數，用來把並行的線錯開

    # -- 內容登記 --------------------------------------------------------
    def node(self, nid, name, table, kind, col, row, ghost=False):
        self.nodes[nid] = {
            "id": nid, "name": name, "table": table, "kind": kind,
            "x": self.col_x[col], "y": self.row_y[row],
            "col": col, "row": row, "ghost": ghost,
        }

    def module(self, title, note, members):
        self.modules.append({"title": title, "note": note, "members": members})

    def edge(self, a, b, label, cards=("one", "many"), wps=None, dash=False):
        """wps＝途經的通道，元素為 ('x', 值) 或 ('y', 值)，None 代表直線相連。"""
        self.edges.append({"a": a, "b": b, "label": label, "cards": cards,
                           "wps": wps or [], "dash": dash})

    # -- 通道座標 --------------------------------------------------------
    def gutter(self, g):
        """垂直通道的 x。g 可為 0..n-2（第 g 與 g+1 欄之間）或 'L' / 'R'（最外側）。"""
        if g == "L":
            base = self.col_x[0] - MOD_PAD - 20
        elif g == "R":
            base = self.col_x[-1] + NODE_W + MOD_PAD + 20
        else:
            base = self.col_x[g] + NODE_W + COL_GAP / 2
        return base + self._offset(("x", g))

    def channel(self, r):
        """水平通道的 y。r 為第 r 與 r+1 列之間；r = -1 代表第一列上方。"""
        if r < 0:
            base = self.row_y[0] - ROW_GAP / 2
        else:
            base = self.row_y[r] + NODE_H + ROW_GAP / 2
        return base + self._offset(("y", r))

    def _offset(self, key):
        """同一條通道被多條線用到時，左右（上下）錯開，避免整條線疊在一起。"""
        n = self._lane.get(key, 0)
        self._lane[key] = n + 1
        return [0, 14, -14, 28, -28, 42, -42][n % 7]

    # -- 走線 ------------------------------------------------------------
    def _sides(self, e):
        """依第一段 / 最後一段的走向，決定線從方塊哪一邊出、從哪一邊進。"""
        a, b = self.nodes[e["a"]], self.nodes[e["b"]]
        wps = e["wps"]
        if wps:
            first, last = wps[0], wps[-1]
        else:
            # 沒指定通道：同列走水平、同欄走垂直
            first = last = ("x", None) if a["row"] == b["row"] else ("y", None)

        if first[0] == "x":
            tx = first[1] if first[1] is not None else b["x"] + NODE_W / 2
            sa = "right" if tx > a["x"] + NODE_W / 2 else "left"
        else:
            ty = first[1] if first[1] is not None else b["y"] + NODE_H / 2
            sa = "bottom" if ty > a["y"] + NODE_H / 2 else "top"

        if last[0] == "x":
            fx = last[1] if last[1] is not None else a["x"] + NODE_W / 2
            sb = "left" if fx < b["x"] + NODE_W / 2 else "right"
        else:
            fy = last[1] if last[1] is not None else a["y"] + NODE_H / 2
            sb = "top" if fy < b["y"] + NODE_H / 2 else "bottom"
        return sa, sb

    def _ports(self):
        """把每個方塊每一邊的連接點平均攤開，兩條線才不會從同一點出發。"""
        slots = {}
        for i, e in enumerate(self.edges):
            sa, sb = self._sides(e)
            e["sa"], e["sb"] = sa, sb
            slots.setdefault((e["a"], sa), []).append((i, "a"))
            slots.setdefault((e["b"], sb), []).append((i, "b"))

        for (nid, side), users in slots.items():
            n = self.nodes[nid]

            # 依「對面端點」的座標排序，線才不會無謂地交叉
            def key(u):
                other = self.nodes[self.edges[u[0]]["b" if u[1] == "a" else "a"]]
                return other["y"] if side in ("left", "right") else other["x"]

            users.sort(key=key)
            span = (NODE_H if side in ("left", "right") else NODE_W) * PORT_SPREAD
            k = len(users)
            for j, (ei, which) in enumerate(users):
                t = 0.5 if k == 1 else j / (k - 1)
                off = (t - 0.5) * span
                if side == "left":
                    px, py = n["x"], n["y"] + NODE_H / 2 + off
                elif side == "right":
                    px, py = n["x"] + NODE_W, n["y"] + NODE_H / 2 + off
                elif side == "top":
                    px, py = n["x"] + NODE_W / 2 + off, n["y"]
                else:
                    px, py = n["x"] + NODE_W / 2 + off, n["y"] + NODE_H
                self.edges[ei][f"p{which}"] = (px, py)

    def _points(self, e):
        """由起點、途經通道、終點組出折線的所有轉折點。"""
        (sx, sy), (tx, ty) = e["pa"], e["pb"]
        pts = [(sx, sy)]
        cx, cy = sx, sy
        for kind, val in e["wps"]:
            if kind == "x":
                pts.append((val, cy))
                cx = val
            else:
                pts.append((cx, val))
                cy = val
        # 最後一段：從目前位置轉進終點所在的那一邊
        if e["sb"] in ("left", "right"):
            pts.append((cx, ty))
        else:
            pts.append((tx, cy))
        pts.append((tx, ty))

        # 同列直線相連時，兩端連接點的 y 可能差幾像素，會出現難看的小折角。
        # 差距很小就直接拉平成一條直線。
        if not e["wps"] and abs(sy - ty) < 6 and e["sa"] in ("left", "right"):
            mid = (sy + ty) / 2
            pts = [(sx, mid), (tx, mid)]
        elif not e["wps"] and abs(sx - tx) < 6 and e["sa"] in ("top", "bottom"):
            mid = (sx + tx) / 2
            pts = [(mid, sy), (mid, ty)]
        return dedupe(pts)

    # -- 輸出 ------------------------------------------------------------
    def _module_rect(self, m):
        """模組灰框的外框座標；框內成員的外接矩形再加內距。"""
        ns = [self.nodes[i] for i in m["members"]]
        return (min(n["x"] for n in ns) - MOD_PAD,
                min(n["y"] for n in ns) - MOD_PAD,
                max(n["x"] + NODE_W for n in ns) + MOD_PAD,
                max(n["y"] + NODE_H for n in ns) + MOD_PAD_B)

    def _title_bands(self):
        """模組灰框底部那一條「模組標題帶」。關係標籤要避開，否則會疊字。

        上下各再多留 10：標籤本身有高度，只避開帶子本身還是會擦到邊。
        """
        return [(x0, y1 - MOD_PAD_B - 10, x1, y1 + 10)
                for x0, _, x1, y1 in map(self._module_rect, self.modules)]

    def _draw_modules(self):
        out = []
        for m in self.modules:
            x0, y0, x1, y1 = self._module_rect(m)
            out.append(rect(x0, y0, x1 - x0, y1 - y0, MODULE_BG, rx=12))
            out.append(txt(x0 + 12, y1 - 8, m["title"], size=13,
                           weight="700", fill=MODULE_FG))
            out.append(txt(x0 + 15 + est_width(m["title"], 13), y1 - 8,
                           m["note"], size=10, fill=INK_MUTE))
        return "".join(out)

    def _draw_edges(self):
        out, labels = [], []
        bands = self._title_bands()
        for e in self.edges:
            pts = self._points(e)
            e["pts"] = pts
            color = LINE_DIM if e["dash"] else LINE
            out.append(path(rounded_path(pts), color, 1.4,
                            dash="5 4" if e["dash"] else None))

            # 兩端的雞爪：方向取最靠近端點那一段的走向
            for p_far, p_end, card in ((pts[1], pts[0], e["cards"][0]),
                                       (pts[-2], pts[-1], e["cards"][1])):
                dx, dy = p_end[0] - p_far[0], p_end[1] - p_far[1]
                L = hypot(dx, dy) or 1
                out.append(crow(p_end[0], p_end[1], dx / L, dy / L, card, color))

            if e["label"]:
                labels.append(self._draw_label(pts, e["label"], bands))
        # 標籤最後畫，才不會被後面的線壓過去
        return "".join(out) + "".join(labels)

    def _draw_label(self, pts, s, bands):
        """標籤放在最長的一段上，底下墊一塊畫布色，蓋掉線讓字看得清楚。

        水平段的字擺在線的**正上方**（線本身不被蓋住，比較好追）；
        垂直段沒有上下可讓，就直接壓在線上——底色會把線切開一小段。

        `bands` 是模組標題帶。挑選順序：
        1. 夠長（放得下標籤）且不在標題帶上 → 最理想
        2. 夠長但落在標題帶上 → 次之
        3. 都不夠長 → 就選最長的，寧可擠一點也不要沒有標籤

        「夠長」這條不能省：不加的話，為了閃開標題帶會挑到某段只有十幾像素
        的短折線，標籤就有一半壓在方塊上，而方塊是最後畫的，會把字蓋掉。
        """
        w = est_width(s, 12) + 10

        def pick(skip_bands, min_len):
            best, blen = None, -1
            for a, b in zip(pts, pts[1:]):
                mx, my = (a[0] + b[0]) / 2, (a[1] + b[1]) / 2
                d = hypot(b[0] - a[0], b[1] - a[1])
                if d < min_len:
                    continue
                if skip_bands and any(x0 <= mx <= x1 and y0 <= my <= y1
                                      for x0, y0, x1, y1 in bands):
                    continue
                if d > blen:
                    best, blen = (a, b), d
            return best

        (ax, ay), (bx, by) = pick(True, w) or pick(False, w) or pick(False, 0)
        mx, my = (ax + bx) / 2, (ay + by) / 2
        if abs(by - ay) < 1:
            my -= 11
        return (rect(mx - w / 2, my - 9, w, 18, CANVAS, rx=5) +
                txt(mx, my + 3.5, s, size=12, fill=INK_SUB, anchor="middle"))

    def _draw_nodes(self):
        out = []
        for n in self.nodes.values():
            accent, tint = TYPE[n["kind"]]
            if n["ghost"]:
                out.append(rect(n["x"], n["y"], NODE_W, NODE_H, NODE_BG, rx=9,
                                stroke=accent, sw=1.4, dash="5 4"))
            else:
                out.append(rect(n["x"], n["y"], NODE_W, NODE_H, tint, rx=9,
                                stroke=accent, sw=1.4))
            cx = n["x"] + NODE_W / 2
            out.append(txt(cx, n["y"] + 24, n["name"], size=21, weight="700",
                           fill=accent, anchor="middle"))
            out.append(txt(cx, n["y"] + 40, n["table"], size=11, fill=INK_MUTE,
                           anchor="middle", family=MONO))
        return "".join(out)

    def _content_bbox(self):
        """圖形內容的外接矩形：模組框、方塊、走線轉折點全部算進去。"""
        xs, ys = [], []
        for m in self.modules:
            x0, y0, x1, y1 = self._module_rect(m)
            xs += [x0, x1]
            ys += [y0, y1]
        for n in self.nodes.values():
            xs += [n["x"], n["x"] + NODE_W]
            ys += [n["y"], n["y"] + NODE_H]
        for e in self.edges:
            for x, y in e["pts"]:
                xs.append(x)
                ys.append(y)
        # 邊界再往外留一點，免得雞爪或標籤底色被切到
        return min(xs) - 14, min(ys) - 14, max(xs) + 14, max(ys) + 14

    def render(self, meta):
        self._ports()
        # 先畫，才知道走線實際跑到哪；之後再統一縮放置中
        art = self._draw_modules() + self._draw_edges() + self._draw_nodes()

        bx0, by0, bx1, by1 = self._content_bbox()
        dx0, dy0, dx1, dy1 = DIAG
        s = min((dx1 - dx0) / (bx1 - bx0), (dy1 - dy0) / (by1 - by0), FIT_MAX)
        tx = dx0 + ((dx1 - dx0) - (bx1 - bx0) * s) / 2 - bx0 * s
        ty = dy0 + ((dy1 - dy0) - (by1 - by0) * s) / 2 - by0 * s

        body = [
            # 頁首刻意壓小：主角是下面那張圖，不是標題
            txt(46, 34, meta["title"], size=20, weight="700", fill=INK),
            txt(46, 54, meta["subtitle"], size=12, fill=INK_SUB),
            txt(W - 46, 34, meta["page"], size=14, weight="700",
                fill=INK_MUTE, anchor="end"),
            f'<line x1="46" y1="64" x2="{W - 46}" y2="64" stroke="{RULE}" '
            f'stroke-width="1"/>',
            f'<g transform="translate({f(tx)},{f(ty)}) scale({s:.4f})">'
            f'{art}</g>',
            legend(46, LEGEND_Y, W - 92, meta["callout"]),
            txt(46, H - 10, meta["footer"], size=9, fill=INK_MUTE),
        ]
        return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" '
                f'height="{H}" viewBox="0 0 {W} {H}" '
                f'font-family="{FONT}" role="img">'
                f'<title>{esc(meta["title"])}</title>'
                f'<rect width="{W}" height="{H}" fill="{CANVAS}"/>'
                f'{"".join(body)}</svg>')


def legend(x, y, w, callout):
    """圖例：類型色票 + 線條記法 + 一句話重點。"""
    out = [rect(x, y, w, LEGEND_H, PANEL_BG, rx=10, stroke=PANEL_BORDER),
           txt(x + 14, y + 18, "資料表類型", size=12, weight="700", fill=INK)]

    cx = x + 92
    for key, label in TYPE_LABELS:
        accent, tint = TYPE[key]
        out.append(rect(cx, y + 8, 13, 13, tint, rx=3, stroke=accent, sw=1.4))
        out.append(txt(cx + 19, y + 18, label, size=11, fill=INK_SUB))
        cx += 19 + est_width(label, 11) + 20

    # 雞爪記法：直接畫一小段線 + 符號，比文字說明好懂
    lx = x + 14
    out.append(txt(lx, y + 42, "線的兩端", size=12, weight="700", fill=INK))
    lx += 78
    for kind, label in (("one", "剛好一筆"), ("many", "多筆"),
                        ("zero_many", "可能沒有")):
        out.append(path(f"M{f(lx)},{f(y + 38)} L{f(lx + 28)},{f(y + 38)}",
                        LINE, 1.4))
        out.append(crow(lx + 28, y + 38, 1, 0, kind, LINE))
        out.append(txt(lx + 36, y + 42, label, size=11, fill=INK_SUB))
        lx += 36 + est_width(label, 11) + 24
    out.append(path(f"M{f(lx)},{f(y + 38)} L{f(lx + 28)},{f(y + 38)}",
                    LINE_DIM, 1.4, dash="5 4"))
    out.append(txt(lx + 36, y + 42, "虛線 ＝ 跨資料庫，靠共同編號對應（資料庫不強制）",
                   size=11, fill=INK_SUB))

    out.append(txt(x + w - 14, y + 18, callout, size=13, weight="600",
                   fill=INK, anchor="end"))
    return "".join(out)


# ---------------------------------------------------------------------------
# 6. 第 1 頁：PostgreSQL 帳務寫庫（16 張表）
# ---------------------------------------------------------------------------

def build_page1():
    p = Page(n_cols=5, n_rows=5)

    #        id       中文名        技術表名                    類型     欄 列
    p.node("ply",    "玩家編號",    "members.id（第 2 頁）",   "member", 2, 0, ghost=True)
    p.node("topup",  "加值訂單",    "topup_orders",            "money",  0, 1)
    p.node("tx",     "帳務流水",    "wallet_transactions",     "money",  1, 1)
    p.node("wal",    "星幣錢包",    "wallets",                 "money",  2, 1)
    p.node("round",  "對局紀錄",    "game_rounds",             "game",   3, 1)
    p.node("rtp",    "回報率統計",  "game_rtp_stats",          "game",   4, 1)
    p.node("cash",   "虧損返利",    "cashback_records",        "money",  0, 2)
    p.node("dia",    "鑽石錢包",    "diamond_wallets",         "money",  1, 2)
    p.node("outbox", "待發通知箱",  "wallet_outbox",           "sys",    2, 2)
    p.node("pend",   "補付款單",    "pending_wallet_credits",  "game",   3, 2)
    p.node("shopr",  "商城兌換",    "shop_redemptions",        "money",  0, 3)
    p.node("rankw",  "週排行歷史",  "rank_history",            "stat",   3, 3)
    p.node("rankd",  "每日持幣快照", "rank_daily_snapshots",   "stat",   4, 3)
    p.node("admu",   "後台管理員",  "admin_users",             "admin",  0, 4)
    p.node("admlog", "操作稽核紀錄", "admin_action_logs",      "admin",  1, 4)
    p.node("alert",  "風控告警",    "admin_alerts",            "admin",  2, 4)
    p.node("dlq",    "失敗訊息收容", "dead_letter_messages",   "sys",    3, 4)

    p.module("錢包核心", "全站唯一會動到錢的區域", ["tx", "wal", "dia", "outbox"])
    p.module("遊戲營運", "每一局都留完整紀錄", ["round", "rtp", "pend"])
    p.module("收入與回饋", "每分營收與回饋都有單據", ["topup", "cash", "shopr"])
    p.module("排行與資金分布", "定期拍快照存歷史", ["rankw", "rankd"])
    p.module("後台與可靠性", "權力大，所以每個動作都留痕",
             ["admu", "admlog", "alert", "dlq"])

    ch, gt = p.channel, p.gutter
    # 玩家身分：跨庫共用的編號，是所有帳務資料的源頭
    p.edge("ply", "wal", "一人一個", ("one", "one"), dash=True)
    p.edge("ply", "tx", "一人多筆", ("one", "many"), [("y", ch(0))], dash=True)
    p.edge("ply", "round", "一人多局", ("one", "many"), [("y", ch(0))], dash=True)
    p.edge("ply", "dia", "一人一個", ("one", "one"), [("x", gt(0))], dash=True)
    # 錢包核心
    p.edge("wal", "tx", "每筆異動", ("one", "many"))
    p.edge("tx", "outbox", "同一筆交易", ("one", "one"), [("y", ch(1))])
    # 遊戲
    p.edge("round", "wal", "下注與派彩", ("many", "one"))
    p.edge("round", "rtp", "每小時彙總", ("many", "one"))
    p.edge("round", "pend", "派彩失敗", ("one", "zero_many"))
    p.edge("pend", "wal", "重試補入帳", ("many", "one"), [("y", ch(1))])
    # 收入與回饋
    p.edge("topup", "tx", "付款後入帳", ("one", "zero_one"))
    p.edge("cash", "tx", "每期一筆", ("many", "one"), [("y", ch(1))])
    p.edge("shopr", "tx", "兌換扣款", ("many", "one"), [("x", gt(0))])
    # 排行
    p.edge("wal", "rankw", "每週存檔", ("one", "many"), [("x", gt(2))])
    p.edge("wal", "rankd", "每日快照", ("one", "many"),
           [("x", gt(2)), ("y", ch(2))])
    # 後台與可靠性
    p.edge("admu", "admlog", "操作留痕", ("one", "many"))
    p.edge("admlog", "tx", "GM 發幣", ("many", "one"), [("x", gt(0))])
    p.edge("alert", "round", "異常告警", ("many", "one"), [("x", gt(2))])
    p.edge("outbox", "dlq", "投遞失敗", ("one", "zero_many"), [("y", ch(3))])

    return p, {
        "title": "幸運星幣城｜資料庫架構（經營層版）",
        "subtitle": "第 1 頁：帳務與遊戲核心　—　PostgreSQL 帳務寫入主庫，共 16 份資料（工程師版：er-postgres.svg）",
        "page": "1 / 2",
        "callout": "玩家的每一塊錢，都在這一頁算完並留痕。",
        "footer": "資料來源：database/postgres/init.sql（2026-07-23 快照）｜逐表說明見 注解-postgres.md",
    }


# ---------------------------------------------------------------------------
# 7. 第 2 頁：MySQL 查詢讀庫（13 張表）
# ---------------------------------------------------------------------------

def build_page2():
    p = Page(n_cols=4, n_rows=4)

    p.node("fri",   "好友關係",     "friendships",            "member", 0, 0)
    p.node("gift",  "好友贈禮紀錄", "gift_logs",              "member", 1, 0)
    p.node("mem",   "玩家主檔",     "members",                "member", 2, 0)
    p.node("soc",   "第三方登入綁定", "member_social_accounts", "member", 3, 0)
    p.node("tdef",  "任務模板",     "task_definitions",       "quest",  0, 1)
    p.node("ptask", "玩家任務進度", "player_tasks",           "quest",  1, 1)
    p.node("chk",   "每日簽到",     "daily_checkins",         "quest",  2, 1)
    p.node("mon",   "月度大獎領取", "monthly_reward_claims",  "quest",  3, 1)
    p.node("sitem", "商城商品目錄", "shop_items",             "money",  0, 2)
    p.node("dcard", "鑽石點數卡",   "diamond_cards",          "money",  1, 2)
    p.node("vault", "金庫（第 1 頁）", "wallets / wallet_tx",  "money",  3, 2,
           ghost=True)
    # 帳務明細複本刻意也用金流色：跟第 1 頁的「帳務流水」是同一份資料的複本
    p.node("txr",   "帳務明細複本", "wallet_transactions",    "money",  0, 3)
    p.node("obx",   "待發通知箱",   "outbox_events",          "sys",    1, 3)
    p.node("hlth",  "系統健康檢查", "system_health_check",    "sys",    2, 3)

    p.module("會員與社交", "全系統認人的源頭；第三方綁定是本庫唯一的真外鍵",
             ["fri", "gift", "mem", "soc"])
    p.module("任務與簽到", "留存率與日活的主要推手",
             ["tdef", "ptask", "chk", "mon"])
    p.module("商城與鑽石", "營運可自行上下架與調價", ["sitem", "dcard"])
    p.module("查詢複本與維運", "這一區是副本與工具，不是帳務正本",
             ["txr", "obx", "hlth"])

    ch, gt = p.channel, p.gutter
    # 玩家主檔是這一頁的中心：members.id 就是全站通用的 player_id
    p.edge("mem", "gift", "送禮收禮", ("one", "many"))
    p.edge("mem", "soc", "可綁多平台", ("one", "zero_many"))
    # 好友關係被「好友贈禮紀錄」擋住，繞左側外通道進去
    p.edge("mem", "fri", "一人多段", ("one", "many"),
           [("y", ch(0)), ("x", gt("L"))])
    p.edge("mem", "ptask", "一人多筆", ("one", "many"), [("y", ch(0))])
    p.edge("mem", "chk", "一人多天", ("one", "many"))
    p.edge("mem", "mon", "一人多筆", ("one", "many"), [("y", ch(0))])
    p.edge("tdef", "ptask", "模板→進度", ("one", "many"))
    p.edge("chk", "mon", "累計達標", ("many", "one"))
    p.edge("mem", "dcard", "記兌換者", ("one", "zero_many"), [("x", gt(1))])
    p.edge("mem", "txr", "玩家編號", ("one", "many"),
           [("y", ch(0)), ("x", gt("L"))])
    p.edge("mem", "obx", "會員事件", ("one", "many"),
           [("x", gt(1)), ("y", ch(2))])
    # 跨庫（虛線）：金庫在第 1 頁
    p.edge("sitem", "vault", "先驗價再扣款", ("one", "many"), [("y", ch(2))],
           dash=True)
    p.edge("dcard", "vault", "序號換鑽石", ("one", "many"), dash=True)
    p.edge("vault", "txr", "事件同步", ("one", "many"), [("y", ch(2))], dash=True)

    return p, {
        "title": "幸運星幣城｜資料庫架構（經營層版）",
        "subtitle": "第 2 頁：會員與營運活動　—　MySQL 查詢讀庫，共 13 份資料（工程師版：er-mysql.svg）",
        "page": "2 / 2",
        "callout": "查得多、改得少的資料放這裡，查詢不拖慢帳務。",
        "footer": "資料來源：database/mysql/init.sql（2026-07-23 快照）｜逐表說明見 注解-mysql.md",
    }


# ---------------------------------------------------------------------------
# 8. 進入點
# ---------------------------------------------------------------------------

def main():
    out_dir = Path(__file__).resolve().parent
    builders = [
        ("er-架構總覽-1-帳務與遊戲", build_page1),
        ("er-架構總覽-2-會員與營運", build_page2),
    ]
    # 深色沿用參考圖的黑底風格；淺色供列印 / 淺色文件使用。
    # Page 物件內含通道使用次數等狀態，兩種配色各重建一次，避免狀態互相污染。
    for mode, suffix in (("light", ""), ("dark", "-深色")):
        use_theme(mode)
        for stem, build in builders:
            page, meta = build()
            out = out_dir / f"{stem}{suffix}.svg"
            content = page.render(meta)
            out.write_text(content, encoding="utf-8")
            print(f"[ok] {mode:<5} {out.name}  ({len(content):,} bytes)")


if __name__ == "__main__":
    main()
