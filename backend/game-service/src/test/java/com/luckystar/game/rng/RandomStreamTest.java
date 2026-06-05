package com.luckystar.game.rng;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * {@link RandomStream} 的單元測試：邊界、分布均勻性與跨區塊延伸。
 */
class RandomStreamTest {

    private RandomStream stream(long nonce) {
        return new RandomStream(
                "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
                "client-seed",
                nonce);
    }

    @Test
    @DisplayName("nextDouble 落在 [0, 1) 區間")
    void nextDouble_inRange() {
        RandomStream s = stream(1L);
        for (int i = 0; i < 10_000; i++) {
            double v = s.nextDouble();
            assertTrue(v >= 0.0 && v < 1.0, "超出範圍: " + v);
        }
    }

    @Test
    @DisplayName("nextInt(bound) 落在 [0, bound)")
    void nextInt_inRange() {
        RandomStream s = stream(2L);
        int bound = 37; // 用非 2 的冪測試拒絕取樣
        for (int i = 0; i < 10_000; i++) {
            int v = s.nextInt(bound);
            assertTrue(v >= 0 && v < bound, "超出範圍: " + v);
        }
    }

    @Test
    @DisplayName("nextInt 非正 bound 拋出例外")
    void nextInt_rejectsNonPositiveBound() {
        RandomStream s = stream(3L);
        assertThrows(IllegalArgumentException.class, () -> s.nextInt(0));
        assertThrows(IllegalArgumentException.class, () -> s.nextInt(-5));
    }

    @Test
    @DisplayName("空白 seed 於建構時即拋出例外")
    void constructor_rejectsBlankSeeds() {
        assertThrows(IllegalArgumentException.class, () -> new RandomStream("", "c", 0));
        assertThrows(IllegalArgumentException.class, () -> new RandomStream("s", null, 0));
    }

    @Test
    @DisplayName("可跨多個雜湊區塊持續取數（超過單一 32-byte 區塊）")
    void nextInts_spansMultipleBlocks() {
        // 每個 nextInt 耗用 4 bytes，一個區塊 32 bytes ≈ 8 個值；取 100 個必跨多區塊。
        int[] values = stream(4L).nextInts(100, 6);
        assertEquals(100, values.length);
        for (int v : values) {
            assertTrue(v >= 0 && v < 6);
        }
    }

    @Test
    @DisplayName("分布大致均勻（卡方檢定寬鬆門檻）")
    void nextInt_distributionRoughlyUniform() {
        int bound = 10;
        int samples = 100_000;
        int[] counts = new int[bound];
        RandomStream s = stream(99L);
        for (int i = 0; i < samples; i++) {
            counts[s.nextInt(bound)]++;
        }
        double expected = (double) samples / bound;
        double chiSquare = 0.0;
        for (int c : counts) {
            double diff = c - expected;
            chiSquare += diff * diff / expected;
        }
        // 自由度 9 時，卡方臨界值 ~27（p≈0.001）；寬鬆取 30 避免偶發誤判。
        assertTrue(chiSquare < 30.0, "分布偏離過大，卡方值=" + chiSquare);
    }
}
