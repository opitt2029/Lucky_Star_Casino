# -*- coding: utf-8 -*-
"""
Lucky Star Casino — RTP / 機率模型 獨立驗證腳本（三方驗證的「Python」路徑）。

用途
----
以「與後端 Java 引擎完全獨立」的手寫實作，重算三款遊戲的理論 RTP / 機率，
用來交叉驗證：
  ① 後端 Java 引擎的 Javadoc 理論值
  ② 本腳本（獨立重算）
  ③ docs/game-math/RTP-機率模型.xlsx 的活公式
三條路徑互不相依，數字全部吻合才算過關（見該 xlsx 的「驗證報告」分頁）。

本腳本刻意**不 import 任何專案程式碼**，常數/規則全部照抄自 Java 原始碼，
這樣才是真正的「獨立重算」。若後端數值有調整，請同步更新此處常數
（比照 AGENTS.md「改數值四同步」紀律）。

對應程式碼
----------
  老虎機 : backend/.../slot/SlotSymbol.java、SlotMachine.java
  捕魚機 : backend/.../fishing/FishingCombat.java、FishSpecies.java
  百家樂 : backend/.../baccarat/BaccaratGameService.java、Card.java
           backend/.../service/BaccaratService.java（反水）

執行
----
  python docs/game-math/verify_rtp.py
（僅需標準函式庫；主控台若為 cp950 而中文亂碼，可設 PYTHONIOENCODING=utf-8）
"""
import sys
from fractions import Fraction as F

try:  # 避免 Windows cp950 主控台印中文時 UnicodeEncodeError
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass


# ────────────────────────────────────────────────────────────────────
# ① 老虎機（SlotSymbol.java / SlotMachine.java）
#    單中線、兩階賠付：三連 pᵢ³·tripleᵢ、左二同 pᵢ²(1−pᵢ)·pairᵢ、右二同不賠。
# ────────────────────────────────────────────────────────────────────
# (weight, pairMultiplier, tripleMultiplier)，順序＝Java enum 宣告序
SLOT = [
    ("CHERRY", 45, 1, 5),
    ("LEMON", 30, 1, 8),
    ("BELL", 16, 2, 18),
    ("STAR", 7, 3, 50),
    ("SEVEN", 5, 5, 70),
]


def slot_stats():
    total = sum(w for _, w, _, _ in SLOT)  # 103
    rtp = 0.0          # E[派彩倍率]（含本金）
    hit = 0.0          # 命中率（三連 + 左二同）
    e_x2 = 0.0         # E[X²]，X = 單局派彩倍率
    for _, w, pair, triple in SLOT:
        p = w / total
        p3 = p ** 3                 # 三連機率
        p2 = p ** 2 * (1 - p)       # 左二同機率（第三格不同）
        rtp += p3 * triple + p2 * pair
        hit += p3 + p2
        e_x2 += p3 * triple ** 2 + p2 * pair ** 2
    var = e_x2 - rtp ** 2
    sd = var ** 0.5
    return {"total": total, "rtp": rtp, "hit": hit, "sd": sd}


# ────────────────────────────────────────────────────────────────────
# ② 捕魚機（FishingCombat.java / FishSpecies.java）
#    HP = mult×10；每發傷害 damage，暴擊(0.2)則 ×2。
#    E[N]=期望擊殺發數（含暴擊 DP）；pCapture = TARGET_RTP·E[N]/mult（夾 [0,1]）。
#    每魚種/砲台 RTP = pCapture·mult/E[N] 恆 = TARGET_RTP。
# ────────────────────────────────────────────────────────────────────
TARGET_RTP = 0.96
CRIT_CHANCE = 0.20
CRIT_MULTIPLIER = 2
HP_PER_MULTIPLIER = 10
CANNON_DAMAGE = {1: 10, 2: 14, 3: 18}  # 銅/銀/金


def expected_shots_to_kill(hp, damage):
    """單位 DP：ceil(hp/damage) 個單位，每發 +1（機率1−crit）或 +2（機率crit）。"""
    if hp <= 0:
        return 0.0
    units = (hp + damage - 1) // damage  # ceil
    g = [0.0] * (units + 2)              # g[units]=g[units+1]=0
    for u in range(units - 1, -1, -1):
        g[u] = 1.0 + (1 - CRIT_CHANCE) * g[u + 1] + CRIT_CHANCE * g[u + 2]
    return g[0]


def fishing_pcapture(mult, cannon_level):
    hp = mult * HP_PER_MULTIPLIER
    en = expected_shots_to_kill(hp, CANNON_DAMAGE[cannon_level])
    p = min(1.0, TARGET_RTP * en / mult)
    rtp = p * mult / en  # 應恆 = TARGET_RTP（未夾頂時）
    return {"e_n": en, "pcapture": p, "rtp": rtp}


# ────────────────────────────────────────────────────────────────────
# ③ 百家樂（BaccaratGameService.java / Card.java / BaccaratService.java）
#    無限靴：牌值 A=1、2~9=面值、10/J/Q/K=0 → 值0佔4/13、值1~9各1/13。
#    以加權「精確枚舉」（非蒙地卡羅）算 P(莊)/P(閒)/P(和)。
# ────────────────────────────────────────────────────────────────────
CARD_WEIGHT = {0: 4, **{v: 1 for v in range(1, 10)}}  # 值 → 張數（/13）


def _wv(v):
    return F(CARD_WEIGHT[v], 13)


def _banker_draws(bscore, p3):
    """莊家補牌規則，鏡像 BaccaratGameService.bankerDraws。p3=None 表閒家未補牌。"""
    if p3 is None:
        return bscore <= 5
    if bscore in (0, 1, 2):
        return True
    if bscore == 3:
        return p3 != 8
    if bscore == 4:
        return 2 <= p3 <= 7
    if bscore == 5:
        return 4 <= p3 <= 7
    if bscore == 6:
        return 6 <= p3 <= 7
    return False  # 7


def baccarat_probs():
    """精確枚舉莊/閒/和機率（Fraction 全精度，最後轉 float）。"""
    pB = pP = pT = F(0)
    for p1 in range(10):
        for p2 in range(10):
            ppair = _wv(p1) * _wv(p2)
            sp = (p1 + p2) % 10
            for b1 in range(10):
                for b2 in range(10):
                    base = ppair * _wv(b1) * _wv(b2)
                    sb = (b1 + b2) % 10
                    if sp >= 8 or sb >= 8:          # 任一天牌 → 雙方停牌
                        combos = [(sp, sb, base)]
                    else:
                        combos = []
                        if sp <= 5:                 # 閒家補第三張
                            for p3 in range(10):
                                w3 = _wv(p3) * base
                                sp2 = (sp + p3) % 10
                                if _banker_draws(sb, p3):
                                    for b3 in range(10):
                                        combos.append((sp2, (sb + b3) % 10, w3 * _wv(b3)))
                                else:
                                    combos.append((sp2, sb, w3))
                        else:                       # 閒家 6~7 停牌
                            if _banker_draws(sb, None):
                                for b3 in range(10):
                                    combos.append((sp, (sb + b3) % 10, base * _wv(b3)))
                            else:
                                combos.append((sp, sb, base))
                    for fsp, fsb, w in combos:
                        if fsp > fsb:
                            pP += w
                        elif fsb > fsp:
                            pB += w
                        else:
                            pT += w
    return {"banker": pB, "player": pP, "tie": pT, "sum": pB + pP + pT}


# 賠付 / 反水（BaccaratGameService、BaccaratService.java:191）
BANKER_COMMISSION_RATE = 0.05
TIE_PAYOUT_RATIO = 8          # 和 8:1
REBATE_RATE = F(1, 200)       # 每局 0.5%（bet≥200 精確；最低 1 星幣）


def baccarat_rtp(pr):
    pB, pP, pT = pr["banker"], pr["player"], pr["tie"]
    # 押閒：贏(P)派2倍、和(T)push退1、輸0
    rtp_p = 2 * pP + 1 * pT
    # 押莊：贏(B)派 (2−傭金)、和(T)push退1、輸0
    rtp_b = (2 - F(1, 20)) * pB + 1 * pT
    # 押和：中(T)派 (1+8)=9 倍、其餘0
    rtp_t = (1 + TIE_PAYOUT_RATIO) * pT
    return {
        "player": {"rtp": rtp_p, "edge": 1 - rtp_p, "rtp_rebate": rtp_p + REBATE_RATE},
        "banker": {"rtp": rtp_b, "edge": 1 - rtp_b, "rtp_rebate": rtp_b + REBATE_RATE},
        "tie": {"rtp": rtp_t, "edge": 1 - rtp_t, "rtp_rebate": rtp_t + REBATE_RATE},
    }


# ────────────────────────────────────────────────────────────────────
def main():
    print("=" * 60)
    print("Lucky Star Casino — RTP 三方驗證（Python 獨立重算）")
    print("=" * 60)

    s = slot_stats()
    print("\n【① 老虎機】(權重總和 %d)" % s["total"])
    print("  RTP（含本金） = %.5f   (Java Javadoc ≈ 0.938)" % s["rtp"])
    print("  命中率        = %.5f   (Java Javadoc ≈ 0.307)" % s["hit"])
    print("  單局 SD       = %.4f" % s["sd"])

    print("\n【② 捕魚機】TARGET_RTP=%.2f, crit=%.2f×%d" % (TARGET_RTP, CRIT_CHANCE, CRIT_MULTIPLIER))
    for name, mult, lv in [("財神(金炮lv3)", 100, 3), ("財神(銅炮lv1)", 100, 1), ("錦鯉(金炮lv3)", 2, 3)]:
        r = fishing_pcapture(mult, lv)
        print("  %-14s E[N]=%.3f  pCapture=%.4f  RTP驗證=%.5f"
              % (name, r["e_n"], r["pcapture"], r["rtp"]))

    pr = baccarat_probs()
    rtp = baccarat_rtp(pr)
    print("\n【③ 百家樂】(無限靴 精確枚舉)")
    print("  P(莊)=%.6f  P(閒)=%.6f  P(和)=%.6f  合計=%.10f"
          % (float(pr["banker"]), float(pr["player"]), float(pr["tie"]), float(pr["sum"])))
    for k, zh in [("banker", "押莊"), ("player", "押閒"), ("tie", "押和")]:
        b = rtp[k]
        print("  %s RTP=%.5f  莊家優勢=%.5f  +反水RTP=%.5f"
              % (zh, float(b["rtp"]), float(b["edge"]), float(b["rtp_rebate"])))

    # 自我斷言：合計必須精確 = 1
    assert pr["sum"] == 1, "百家樂機率合計不為 1，枚舉有漏！"
    print("\n✓ 自我檢查通過：百家樂機率合計精確 = 1")


if __name__ == "__main__":
    main()
