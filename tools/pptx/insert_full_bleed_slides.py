#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把整頁滿版圖片插進簡報的指定頁次。

用途
----
ER 架構圖（`docs/assets/er/er-架構總覽-*.svg` 轉出的 PNG）本身已經自帶標題與
註腳，所以在簡報裡就該「整頁鋪滿」，不要再套簡報的標題版面——圖才是主角。

為什麼插 PNG 不插 SVG？PowerPoint 對 SVG 的支援看版本臉色（舊版直接顯示不出來），
PNG 最保險。點陣圖怕糊，所以來源 PNG 用 3 倍解析度（3840×2160）產生。

用法
----
    python tools/pptx/insert_full_bleed_slides.py \
        --pptx "來源.pptx" --out "輸出.pptx" --at 3 \
        --images a.png b.png

`--at` 是 1-based 頁次。該頁若本來就是空白頁（沒有任何形狀），就直接用它；
否則會在該位置插入新頁，原本的內容整批往後移。
"""

import argparse
import copy
import shutil
from pathlib import Path

from pptx import Presentation
from pptx.util import Emu


def blank_layout(prs):
    """挑一個最乾淨的版面配置：形狀最少的那個，通常就是空白版面。"""
    return min(prs.slide_layouts, key=lambda lo: len(lo.placeholders))


def strip_placeholders(slide):
    """清掉版面帶進來的空placeholder，否則簡報上會出現「按一下以新增標題」。"""
    for shape in list(slide.shapes):
        if shape.is_placeholder:
            shape._element.getparent().remove(shape._element)


def move_slide(prs, from_idx, to_idx):
    """把第 from_idx 張（0-based）搬到 to_idx。python-pptx 沒有現成 API，
    只能直接動 presentation.xml 裡的 <p:sldIdLst> 順序。"""
    ids = prs.slides._sldIdLst
    entry = list(ids)[from_idx]
    ids.remove(entry)
    ids.insert(to_idx, entry)


def add_slide_at(prs, index):
    """在 index（0-based）插入一張空白頁並回傳。新頁一律先加到最後再搬位置。"""
    slide = prs.slides.add_slide(blank_layout(prs))
    strip_placeholders(slide)
    move_slide(prs, len(prs.slides) - 1, index)
    return slide


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pptx", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--at", type=int, required=True, help="1-based 起始頁次")
    ap.add_argument("--images", nargs="+", required=True)
    args = ap.parse_args()

    # 不動使用者的原檔：先整份複製一份再改，出事還有原檔可回頭
    shutil.copyfile(args.pptx, args.out)
    prs = Presentation(args.out)

    start = args.at - 1
    for i, img in enumerate(args.images):
        idx = start + i
        if idx < len(prs.slides) and not prs.slides[idx].shapes:
            slide = prs.slides[idx]          # 本來就是空白頁 → 直接用
            action = "填入空白頁"
        else:
            slide = add_slide_at(prs, idx)
            action = "插入新頁"
        # 滿版：左上角對齊 (0,0)，寬高等於整張投影片
        slide.shapes.add_picture(str(Path(img)), Emu(0), Emu(0),
                                 width=prs.slide_width,
                                 height=prs.slide_height)
        print(f"[ok] 第 {idx + 1} 頁 {action}：{Path(img).name}")

    prs.save(args.out)
    print(f"[done] {args.out}（共 {len(prs.slides)} 頁）")


if __name__ == "__main__":
    main()
