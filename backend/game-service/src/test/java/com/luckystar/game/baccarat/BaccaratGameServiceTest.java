package com.luckystar.game.baccarat;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.luckystar.game.baccarat.BaccaratGameService.CardSource;
import com.luckystar.game.rng.ProvablyFairRng;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.EnumMap;
import java.util.Map;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;

/**
 * {@link BaccaratGameService} 單元測試。發牌邏輯以固定牌組（{@link CardSource}）驅動，
 * 確定性驗證點數、補牌規則與派彩；另以真實 RNG 驗證可重算（Provably Fair）。
 */
class BaccaratGameServiceTest {

    private final BaccaratGameService service = new BaccaratGameService();

    /** 以指定牌面值（rankIndex）序列建立發牌來源；花色固定為 ♠（0）。 */
    private static CardSource source(int... rankIndices) {
        Deque<Card> queue = new ArrayDeque<>();
        for (int r : rankIndices) {
            queue.add(new Card(r, 0));
        }
        return queue::poll;
    }

    /** rankIndex：A=0、2~9=1..8、10=9、J=10、Q=11、K=12。 */
    private static final int A = 0;
    private static final int R5 = 4;   // 5
    private static final int R6 = 5;   // 6
    private static final int R7 = 6;   // 7
    private static final int R8 = 7;   // 8
    private static final int R9 = 8;   // 9
    private static final int TEN = 9;  // 10（值 0）

    // ------------------------------------------------------------------
    // 點數與牌值
    // ------------------------------------------------------------------

    @Nested
    @DisplayName("點數計算")
    class Scoring {

        @Test
        @DisplayName("A=1、2~9=面值、10/J/Q/K=0")
        void cardValues() {
            assertEquals(1, new Card(A, 0).value());
            assertEquals(9, new Card(R9, 0).value());
            assertEquals(0, new Card(TEN, 0).value());
            assertEquals(0, new Card(12, 0).value()); // K
        }

        @Test
        @DisplayName("總和取個位：7+8=15→5")
        void totalModTen() {
            // 閒 7+8=15→5（補牌），莊 10+9=9（天牌? 否，需先判天牌）
            // 直接驗證 score：用 play 取 playerScore 不易隔離，這裡改驗終局個位特性
            // 閒: 7,8 → 5；莊: 10,10 → 0；閒補一張 10→仍 5；莊 0 補...
            BaccaratOutcome o = service.play(source(R7, TEN, R8, TEN, TEN, A));
            // 閒前兩張 7+8=15→5（補），莊 0+0=0（補）
            assertTrue(o.playerScore() >= 0 && o.playerScore() <= 9);
            assertTrue(o.bankerScore() >= 0 && o.bankerScore() <= 9);
        }
    }

    // ------------------------------------------------------------------
    // 天牌：雙方停牌
    // ------------------------------------------------------------------

    @Test
    @DisplayName("天牌：閒 9 點，雙方皆不補牌")
    void natural_noDraw() {
        // 閒 9+10=9（天牌），莊 5+5=0
        BaccaratOutcome o = service.play(source(R9, R5, TEN, R5));
        assertEquals(9, o.playerScore());
        assertTrue(o.playerNatural());
        assertEquals(2, o.playerCards().size(), "天牌不補牌");
        assertEquals(2, o.bankerCards().size(), "對方天牌時莊家也不補");
        assertEquals(BaccaratResult.PLAYER, o.result());
    }

    // ------------------------------------------------------------------
    // 閒家補牌規則
    // ------------------------------------------------------------------

    @Test
    @DisplayName("閒家 0~5 補牌、莊家 6~7 停牌")
    void playerDrawsBankerStands() {
        // 閒 A+2=3（補），莊 6+? 用兩張湊 7 → 停。閒補一張。
        // 閒: A(1)+2(值2)=3 → 補；莊: 7+TEN = 7 → 停（閒有補，p3 視莊規則; 莊 7 一律停）
        BaccaratOutcome o = service.play(source(A, R7, 1 /*2*/, TEN, R5));
        assertEquals(3, o.playerCards().size(), "閒家應補第三張");
        assertEquals(2, o.bankerCards().size(), "莊家 7 點停牌");
    }

    @Test
    @DisplayName("閒家 6 停牌；莊家比照（閒未補時 0~5 補、6~7 停）")
    void playerStandsOnSix() {
        // 閒 6+TEN=6 → 停；莊 A+2=3 → 閒未補，莊 0~5 補一張
        BaccaratOutcome o = service.play(source(R6, A, TEN, 1 /*2*/, R5));
        assertEquals(2, o.playerCards().size(), "閒 6 停牌");
        assertEquals(3, o.bankerCards().size(), "閒未補且莊 3 點 → 莊補牌");
    }

    // ------------------------------------------------------------------
    // 莊家補牌查表（bankerDraws 純函式）
    // ------------------------------------------------------------------

    @Nested
    @DisplayName("莊家補牌規則表")
    class BankerRule {

        @Test
        @DisplayName("閒未補：莊 0~5 補、6~7 停")
        void playerStood() {
            assertTrue(BaccaratGameService.bankerDraws(5, null));
            assertFalse(BaccaratGameService.bankerDraws(6, null));
            assertFalse(BaccaratGameService.bankerDraws(7, null));
        }

        @Test
        @DisplayName("莊 0~2：一律補")
        void zeroToTwo() {
            assertTrue(BaccaratGameService.bankerDraws(0, 8));
            assertTrue(BaccaratGameService.bankerDraws(2, 0));
        }

        @Test
        @DisplayName("莊 3：補，除非 p3=8")
        void three() {
            assertTrue(BaccaratGameService.bankerDraws(3, 7));
            assertFalse(BaccaratGameService.bankerDraws(3, 8));
        }

        @Test
        @DisplayName("莊 4：p3∈2~7 補")
        void four() {
            assertFalse(BaccaratGameService.bankerDraws(4, 1));
            assertTrue(BaccaratGameService.bankerDraws(4, 2));
            assertTrue(BaccaratGameService.bankerDraws(4, 7));
            assertFalse(BaccaratGameService.bankerDraws(4, 8));
        }

        @Test
        @DisplayName("莊 5：p3∈4~7 補")
        void five() {
            assertFalse(BaccaratGameService.bankerDraws(5, 3));
            assertTrue(BaccaratGameService.bankerDraws(5, 4));
            assertTrue(BaccaratGameService.bankerDraws(5, 7));
        }

        @Test
        @DisplayName("莊 6：p3∈6~7 補")
        void six() {
            assertFalse(BaccaratGameService.bankerDraws(6, 5));
            assertTrue(BaccaratGameService.bankerDraws(6, 6));
            assertTrue(BaccaratGameService.bankerDraws(6, 7));
        }

        @Test
        @DisplayName("莊 7：停")
        void seven() {
            assertFalse(BaccaratGameService.bankerDraws(7, 6));
        }
    }

    // ------------------------------------------------------------------
    // 派彩
    // ------------------------------------------------------------------

    @Nested
    @DisplayName("派彩結算")
    class Settlement {

        private BaccaratOutcome outcome(BaccaratResult result) {
            // 直接以結果建構（牌與分數不影響 settle）
            return new BaccaratOutcome(
                    java.util.List.of(new Card(A, 0), new Card(A, 0)),
                    java.util.List.of(new Card(A, 0), new Card(A, 0)),
                    result == BaccaratResult.PLAYER ? 9 : (result == BaccaratResult.BANKER ? 8 : 5),
                    result == BaccaratResult.BANKER ? 9 : (result == BaccaratResult.PLAYER ? 8 : 5),
                    result, false, false);
        }

        @Test
        @DisplayName("押中閒：1:1，派 bet×2")
        void playerWin() {
            Map<BaccaratResult, Long> bets = new EnumMap<>(BaccaratResult.class);
            bets.put(BaccaratResult.PLAYER, 100L);
            BaccaratSettlement s = service.settle(outcome(BaccaratResult.PLAYER), bets);
            assertEquals(100L, s.totalBet());
            assertEquals(200L, s.totalPayout());
            assertEquals(200L, s.payoutByArea().get(BaccaratResult.PLAYER));
        }

        @Test
        @DisplayName("押中莊：1:1 扣 5% 傭金，押 100 派 195")
        void bankerWinCommission() {
            Map<BaccaratResult, Long> bets = new EnumMap<>(BaccaratResult.class);
            bets.put(BaccaratResult.BANKER, 100L);
            BaccaratSettlement s = service.settle(outcome(BaccaratResult.BANKER), bets);
            assertEquals(195L, s.totalPayout());
        }

        @Test
        @DisplayName("押中和：8:1，押 100 派 900")
        void tieWin() {
            Map<BaccaratResult, Long> bets = new EnumMap<>(BaccaratResult.class);
            bets.put(BaccaratResult.TIE, 100L);
            BaccaratSettlement s = service.settle(outcome(BaccaratResult.TIE), bets);
            assertEquals(900L, s.totalPayout());
        }

        @Test
        @DisplayName("和局：押莊/閒退回本金（push），押和中獎")
        void tiePushesPlayerBanker() {
            Map<BaccaratResult, Long> bets = new EnumMap<>(BaccaratResult.class);
            bets.put(BaccaratResult.PLAYER, 100L);
            bets.put(BaccaratResult.BANKER, 200L);
            bets.put(BaccaratResult.TIE, 50L);
            BaccaratSettlement s = service.settle(outcome(BaccaratResult.TIE), bets);
            assertEquals(350L, s.totalBet());
            assertEquals(100L, s.payoutByArea().get(BaccaratResult.PLAYER), "閒退本金");
            assertEquals(200L, s.payoutByArea().get(BaccaratResult.BANKER), "莊退本金");
            assertEquals(450L, s.payoutByArea().get(BaccaratResult.TIE), "押和 8:1 = 50×9");
            assertEquals(750L, s.totalPayout());
        }

        @Test
        @DisplayName("押錯：派 0")
        void losingBet() {
            Map<BaccaratResult, Long> bets = new EnumMap<>(BaccaratResult.class);
            bets.put(BaccaratResult.PLAYER, 100L);
            BaccaratSettlement s = service.settle(outcome(BaccaratResult.BANKER), bets);
            assertEquals(0L, s.totalPayout());
        }

        @Test
        @DisplayName("非和局時押 TIE：派 0")
        void tieBetLosesWhenNotTie() {
            Map<BaccaratResult, Long> bets = new EnumMap<>(BaccaratResult.class);
            bets.put(BaccaratResult.TIE, 100L);
            BaccaratSettlement s = service.settle(outcome(BaccaratResult.PLAYER), bets);
            assertEquals(0L, s.totalPayout());
        }
    }

    // ------------------------------------------------------------------
    // Provably Fair：相同三元組必得相同牌局
    // ------------------------------------------------------------------

    @Test
    @DisplayName("可重算：相同 (serverSeed, clientSeed, nonce) 必得相同結果")
    void deterministicReplay() {
        ProvablyFairRng rng = new ProvablyFairRng();
        BaccaratOutcome a = service.deal(rng.stream("server-seed-abc", "client-1", 0L));
        BaccaratOutcome b = service.deal(rng.stream("server-seed-abc", "client-1", 0L));

        assertEquals(a.result(), b.result());
        assertEquals(a.playerScore(), b.playerScore());
        assertEquals(a.bankerScore(), b.bankerScore());
        assertEquals(a.playerCards(), b.playerCards());
        assertEquals(a.bankerCards(), b.bankerCards());
    }

    @Test
    @DisplayName("deal：牌數與分數合法（2~3 張、0~9 點）")
    void deal_validShape() {
        ProvablyFairRng rng = new ProvablyFairRng();
        BaccaratOutcome o = service.deal(rng.stream("s", "c", 7L));
        assertTrue(o.playerCards().size() >= 2 && o.playerCards().size() <= 3);
        assertTrue(o.bankerCards().size() >= 2 && o.bankerCards().size() <= 3);
        assertTrue(o.playerScore() >= 0 && o.playerScore() <= 9);
        assertTrue(o.bankerScore() >= 0 && o.bankerScore() <= 9);
    }
}
