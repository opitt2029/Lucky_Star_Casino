package com.luckystar.game.slot;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/** {@link SlotSymbol} 單元測試：權重總和、加權索引對應、賠付參數。 */
class SlotSymbolTest {

    @Test
    @DisplayName("TOTAL_WEIGHT 等於各符號權重總和")
    void totalWeightIsSum() {
        int sum = 0;
        for (SlotSymbol s : SlotSymbol.values()) {
            sum += s.weight();
        }
        assertEquals(sum, SlotSymbol.TOTAL_WEIGHT);
        assertEquals(100, SlotSymbol.TOTAL_WEIGHT, "目前設定權重總和應為 100");
    }

    @Test
    @DisplayName("fromWeightedIndex 依累積權重區間對應符號（含邊界）")
    void fromWeightedIndex_mapsCumulativeRanges() {
        // CHERRY[0,30) LEMON[30,56) BELL[56,76) STAR[76,90) SEVEN[90,100)
        assertEquals(SlotSymbol.CHERRY, SlotSymbol.fromWeightedIndex(0));
        assertEquals(SlotSymbol.CHERRY, SlotSymbol.fromWeightedIndex(29));
        assertEquals(SlotSymbol.LEMON, SlotSymbol.fromWeightedIndex(30));
        assertEquals(SlotSymbol.LEMON, SlotSymbol.fromWeightedIndex(55));
        assertEquals(SlotSymbol.BELL, SlotSymbol.fromWeightedIndex(56));
        assertEquals(SlotSymbol.BELL, SlotSymbol.fromWeightedIndex(75));
        assertEquals(SlotSymbol.STAR, SlotSymbol.fromWeightedIndex(76));
        assertEquals(SlotSymbol.STAR, SlotSymbol.fromWeightedIndex(89));
        assertEquals(SlotSymbol.SEVEN, SlotSymbol.fromWeightedIndex(90));
        assertEquals(SlotSymbol.SEVEN, SlotSymbol.fromWeightedIndex(99));
    }

    @Test
    @DisplayName("fromWeightedIndex 越界拋出例外")
    void fromWeightedIndex_rejectsOutOfRange() {
        assertThrows(IllegalArgumentException.class, () -> SlotSymbol.fromWeightedIndex(-1));
        assertThrows(IllegalArgumentException.class,
                () -> SlotSymbol.fromWeightedIndex(SlotSymbol.TOTAL_WEIGHT));
    }

    @Test
    @DisplayName("每個符號的倍率屬於公告的 {2,3,5,8}，display 非空")
    void payoutParamsAreValid() {
        for (SlotSymbol s : SlotSymbol.values()) {
            int m = s.lineMultiplier();
            assertTrue(m == 2 || m == 3 || m == 5 || m == 8, s + " 倍率異常: " + m);
            assertFalse(s.display().isEmpty(), s + " display 不可為空");
            assertTrue(s.weight() > 0, s + " 權重需為正");
        }
    }

    @Test
    @DisplayName("display 與前端 mockApi 的 emoji code point 完全相符")
    void displayMatchesFrontendCodePoints() {
        // 與 frontend/src/services/mockApi.js 的 slotSymbols 逐一核對
        assertEquals(new String(new int[] {0x1F352}, 0, 1), SlotSymbol.CHERRY.display());
        assertEquals(new String(new int[] {0x1F34B}, 0, 1), SlotSymbol.LEMON.display());
        assertEquals(new String(new int[] {0x1F514}, 0, 1), SlotSymbol.BELL.display());
        assertEquals(new String(new int[] {0x2B50}, 0, 1), SlotSymbol.STAR.display());
        assertEquals(new String(new int[] {0x0037, 0xFE0F, 0x20E3}, 0, 3), SlotSymbol.SEVEN.display());
    }
}
