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
        assertEquals(103, SlotSymbol.TOTAL_WEIGHT, "目前設定權重總和應為 103");
    }

    @Test
    @DisplayName("fromWeightedIndex 依累積權重區間對應符號（含邊界）")
    void fromWeightedIndex_mapsCumulativeRanges() {
        // CHERRY[0,45) LEMON[45,75) BELL[75,91) STAR[91,98) SEVEN[98,103)
        assertEquals(SlotSymbol.CHERRY, SlotSymbol.fromWeightedIndex(0));
        assertEquals(SlotSymbol.CHERRY, SlotSymbol.fromWeightedIndex(44));
        assertEquals(SlotSymbol.LEMON, SlotSymbol.fromWeightedIndex(45));
        assertEquals(SlotSymbol.LEMON, SlotSymbol.fromWeightedIndex(74));
        assertEquals(SlotSymbol.BELL, SlotSymbol.fromWeightedIndex(75));
        assertEquals(SlotSymbol.BELL, SlotSymbol.fromWeightedIndex(90));
        assertEquals(SlotSymbol.STAR, SlotSymbol.fromWeightedIndex(91));
        assertEquals(SlotSymbol.STAR, SlotSymbol.fromWeightedIndex(97));
        assertEquals(SlotSymbol.SEVEN, SlotSymbol.fromWeightedIndex(98));
        assertEquals(SlotSymbol.SEVEN, SlotSymbol.fromWeightedIndex(102));
    }

    @Test
    @DisplayName("fromWeightedIndex 越界拋出例外")
    void fromWeightedIndex_rejectsOutOfRange() {
        assertThrows(IllegalArgumentException.class, () -> SlotSymbol.fromWeightedIndex(-1));
        assertThrows(IllegalArgumentException.class,
                () -> SlotSymbol.fromWeightedIndex(SlotSymbol.TOTAL_WEIGHT));
    }

    @Test
    @DisplayName("兩階賠付參數合法：pair≥1、triple>pair、display 非空、權重為正")
    void payoutParamsAreValid() {
        for (SlotSymbol s : SlotSymbol.values()) {
            int pair = s.pairMultiplier();
            int triple = s.tripleMultiplier();
            assertTrue(pair >= 1, s + " 左二同倍率需 ≥ 1（至少退本金）: " + pair);
            assertTrue(triple > pair, s + " 三連倍率需大於左二同: triple=" + triple + " pair=" + pair);
            assertFalse(s.display().isEmpty(), s + " display 不可為空");
            assertTrue(s.weight() > 0, s + " 權重需為正");
        }
    }

    @Test
    @DisplayName("display 與前端 mockApi 的 emoji code point 完全相符")
    void displayMatchesFrontendCodePoints() {
        // 與 frontend/src/services/mockApi.js 的 SLOT_PAYTABLE 逐一核對
        assertEquals(new String(new int[] {0x1F352}, 0, 1), SlotSymbol.CHERRY.display());
        assertEquals(new String(new int[] {0x1F34B}, 0, 1), SlotSymbol.LEMON.display());
        assertEquals(new String(new int[] {0x1F514}, 0, 1), SlotSymbol.BELL.display());
        assertEquals(new String(new int[] {0x2B50}, 0, 1), SlotSymbol.STAR.display());
        assertEquals(new String(new int[] {0x0037, 0xFE0F, 0x20E3}, 0, 3), SlotSymbol.SEVEN.display());
    }
}
