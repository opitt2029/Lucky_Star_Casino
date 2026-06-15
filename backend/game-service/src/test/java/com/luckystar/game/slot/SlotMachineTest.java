package com.luckystar.game.slot;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.luckystar.game.rng.ProvablyFairRng;
import com.luckystar.game.rng.RandomStream;
import java.util.HashSet;
import java.util.Set;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/** {@link SlotMachine} 單元測試：中線評估、確定性、盤面合法性與 RTP 範圍。 */
class SlotMachineTest {

    private final SlotMachine machine = new SlotMachine();
    private final ProvablyFairRng rng = new ProvablyFairRng();

    private static SlotSymbol[][] board(SlotSymbol[] top, SlotSymbol[] center, SlotSymbol[] bottom) {
        return new SlotSymbol[][] {top, center, bottom};
    }

    @Test
    @DisplayName("中線三連命中：倍率與派彩由符號決定，命中格為中線三格")
    void evaluate_centerLineWin() {
        SlotSymbol[][] b = board(
                new SlotSymbol[] {SlotSymbol.CHERRY, SlotSymbol.LEMON, SlotSymbol.BELL},
                new SlotSymbol[] {SlotSymbol.STAR, SlotSymbol.STAR, SlotSymbol.STAR},
                new SlotSymbol[] {SlotSymbol.SEVEN, SlotSymbol.CHERRY, SlotSymbol.LEMON});

        SlotOutcome o = machine.evaluate(b, 500);

        assertTrue(o.win());
        assertEquals(8, o.multiplier(), "STAR 為 8x");
        assertEquals(4000L, o.payout(), "500 x 8");
        assertArrayEquals(new int[][] {{1, 0}, {1, 1}, {1, 2}}, o.winningCells());
        // 顯示盤面中線應全為 STAR 的 emoji
        assertEquals(SlotSymbol.STAR.display(), o.grid()[1][0]);
        assertEquals(SlotSymbol.STAR.display(), o.grid()[1][1]);
        assertEquals(SlotSymbol.STAR.display(), o.grid()[1][2]);
    }

    @Test
    @DisplayName("中線未三連：未中獎、派彩 0、命中格為空")
    void evaluate_centerLineLose() {
        SlotSymbol[][] b = board(
                new SlotSymbol[] {SlotSymbol.STAR, SlotSymbol.STAR, SlotSymbol.STAR},
                new SlotSymbol[] {SlotSymbol.STAR, SlotSymbol.STAR, SlotSymbol.BELL},
                new SlotSymbol[] {SlotSymbol.STAR, SlotSymbol.STAR, SlotSymbol.STAR});

        SlotOutcome o = machine.evaluate(b, 500);

        assertFalse(o.win());
        assertEquals(0, o.multiplier());
        assertEquals(0L, o.payout());
        assertEquals(0, o.winningCells().length);
    }

    @Test
    @DisplayName("各符號中線三連的倍率正確")
    void evaluate_eachSymbolMultiplier() {
        for (SlotSymbol s : SlotSymbol.values()) {
            SlotSymbol[][] b = board(
                    new SlotSymbol[] {s, s, s},
                    new SlotSymbol[] {s, s, s},
                    new SlotSymbol[] {s, s, s});
            SlotOutcome o = machine.evaluate(b, 100);
            assertEquals(s.lineMultiplier(), o.multiplier(), s.name());
            assertEquals(100L * s.lineMultiplier(), o.payout(), s.name());
        }
    }

    @Test
    @DisplayName("spin 為確定性：相同三元組產出相同盤面與結果")
    void spin_isDeterministic() {
        String server = rng.generateServerSeed();
        SlotOutcome a = machine.spin(rng.stream(server, "client", 1L), 100);
        SlotOutcome b = machine.spin(rng.stream(server, "client", 1L), 100);

        assertEquals(a.win(), b.win());
        assertEquals(a.multiplier(), b.multiplier());
        assertEquals(a.payout(), b.payout());
        for (int r = 0; r < 3; r++) {
            assertArrayEquals(a.grid()[r], b.grid()[r], "第 " + r + " 列盤面應相同");
        }
    }

    @Test
    @DisplayName("spin 盤面為 3x3 且每格皆為合法符號 emoji")
    void spin_gridShapeAndSymbols() {
        Set<String> valid = new HashSet<>();
        for (SlotSymbol s : SlotSymbol.values()) {
            valid.add(s.display());
        }
        SlotOutcome o = machine.spin(rng.stream("srv", "cli", 3L), 100);
        assertEquals(3, o.grid().length);
        for (String[] row : o.grid()) {
            assertEquals(3, row.length);
            for (String cell : row) {
                assertTrue(valid.contains(cell), "非法符號: " + cell);
            }
        }
    }

    @Test
    @DisplayName("spin 暴力搜尋到的命中局，派彩與命中格自洽")
    void spin_winConsistency() {
        SlotOutcome winOutcome = null;
        for (long nonce = 0; nonce < 100_000 && winOutcome == null; nonce++) {
            SlotOutcome o = machine.spin(rng.stream("seed", "client", nonce), 200);
            if (o.win()) {
                winOutcome = o;
            }
        }
        assertNotNull(winOutcome, "10 萬局內必有命中（命中率約 5.6%）");
        assertEquals(200L * winOutcome.multiplier(), winOutcome.payout());
        assertArrayEquals(new int[][] {{1, 0}, {1, 1}, {1, 2}}, winOutcome.winningCells());
        assertEquals(winOutcome.grid()[1][0], winOutcome.grid()[1][1]);
        assertEquals(winOutcome.grid()[1][1], winOutcome.grid()[1][2]);
    }

    @Test
    @DisplayName("大量轉動的 RTP 落在合理範圍（確定性序列，非隨機 → 不會 flaky）")
    void spin_rtpWithinExpectedBand() {
        int spins = 200_000;
        long bet = 100;
        long totalBet = 0;
        long totalPayout = 0;
        long wins = 0;
        for (long nonce = 0; nonce < spins; nonce++) {
            SlotOutcome o = machine.spin(rng.stream("rtp-seed", "client", nonce), bet);
            totalBet += bet;
            totalPayout += o.payout();
            if (o.win()) {
                wins++;
            }
        }
        double rtp = (double) totalPayout / totalBet;
        double hitRate = (double) wins / spins;
        // 理論 RTP 約 0.177、命中率約 0.056；給寬鬆區間以容納抽樣誤差。
        assertTrue(rtp > 0.10 && rtp < 0.28, "RTP 超出預期範圍: " + rtp);
        assertTrue(hitRate > 0.03 && hitRate < 0.09, "命中率超出預期範圍: " + hitRate);
    }

    @Test
    @DisplayName("spin 參數防呆：null stream 與非正下注拋例外")
    void spin_rejectsInvalidArgs() {
        assertThrows(IllegalArgumentException.class, () -> machine.spin(null, 100));
        RandomStream stream = rng.stream("s", "c", 0L);
        assertThrows(IllegalArgumentException.class, () -> machine.spin(stream, 0));
    }
}
