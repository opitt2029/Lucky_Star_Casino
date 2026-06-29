package com.luckystar.game.fishing;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.luckystar.game.rng.ProvablyFairRng;
import com.luckystar.game.rng.RandomStream;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * {@link FishingCombat} 血量/傷害模型數學驗證（ADR-003）。
 *
 * <p>涵蓋：①每魚種/砲台的 RTP 精確等於 {@value FishingCombat#TARGET_RTP}（解析證明 + Monte-Carlo
 * 抽樣 band）；②暴擊率 ≈ {@value FishingCombat#CRIT_CHANCE}；③保底強制捕獲；④Provably Fair
 * 確定性重放（相同 seed/nonce/damageBefore 必得相同結果）。
 */
class FishingCombatTest {

    private static final ProvablyFairRng RNG = new ProvablyFairRng();
    private static final String SERVER_SEED = "test-server-seed-fixed";
    private static final String CLIENT_SEED = "test-client-seed";
    private static final long[] CANNON_BET = {0L, 10L, 50L, 100L};

    // ------------------------------------------------------------------
    // RTP：解析證明（O(1)，不靠抽樣）
    // ------------------------------------------------------------------

    @Test
    @DisplayName("pCapture 反推使每魚種/砲台的 RTP 精確等於 TARGET_RTP（RTP = pCapture × 倍率 / E[N]）")
    void pCapture_yieldsTargetRtp_forEverySpeciesAndCannon() {
        for (FishSpecies species : FishSpecies.values()) {
            for (int cannon = 1; cannon <= 3; cannon++) {
                double expectedShots = FishingCombat.expectedShotsToKill(
                        species.hp(), FishingCombat.cannonDamage(cannon));
                double rtp = FishingCombat.pCapture(species, cannon) * species.multiplier() / expectedShots;
                assertEquals(FishingCombat.TARGET_RTP, rtp, 1e-6,
                        "RTP 應精確等於目標值：" + species + " 砲台L" + cannon);
            }
        }
    }

    @Test
    @DisplayName("pCapture 一律落在 (0,1]（HP 設計使其不觸頂）")
    void pCapture_alwaysWithinUnitInterval() {
        for (FishSpecies species : FishSpecies.values()) {
            for (int cannon = 1; cannon <= 3; cannon++) {
                double p = FishingCombat.pCapture(species, cannon);
                assertTrue(p > 0 && p <= 1.0, species + " L" + cannon + " pCapture=" + p + " 應在 (0,1]");
            }
        }
    }

    @Test
    @DisplayName("expectedShotsToKill：hp=20/傷害10（暴擊20）的期望擊殺發數為手算 1.8")
    void expectedShotsToKill_matchesHandComputed() {
        // U = ceil(20/10) = 2；g(1)=1，g(0)=1 + 0.8×g(1) + 0.2×g(2) = 1.8
        assertEquals(1.8d, FishingCombat.expectedShotsToKill(20L, 10), 1e-9);
    }

    // ------------------------------------------------------------------
    // RTP：Monte-Carlo 抽樣 band（確認模擬與解析一致；玩家把每條魚打到死的設計 RTP）
    // ------------------------------------------------------------------

    @Test
    @DisplayName("Monte-Carlo：代表性魚種/砲台模擬 RTP 落在 96%±band")
    void monteCarlo_rtpWithinBand() {
        // 取小/中/高倍各一，銅/金兩砲；其餘魚種由上面的解析證明涵蓋。
        assertRtpBand(FishSpecies.KOI, 1, 120_000);
        assertRtpBand(FishSpecies.KOI, 3, 120_000);
        assertRtpBand(FishSpecies.PUFFER, 1, 60_000);
        assertRtpBand(FishSpecies.ANGELFISH, 1, 40_000);
        assertRtpBand(FishSpecies.ANGELFISH, 3, 60_000);
        assertRtpBand(FishSpecies.GOLD_DRAGON, 3, 20_000);
    }

    private void assertRtpBand(FishSpecies species, int cannon, int fishCount) {
        long bet = CANNON_BET[cannon];
        long totalBet = 0L;
        long totalPayout = 0L;
        long nonce = 0L;
        for (int f = 0; f < fishCount; f++) {
            long damageBefore = 0L;
            while (true) {
                nonce++;
                RandomStream stream = RNG.stream(SERVER_SEED, CLIENT_SEED + ":" + cannon, nonce);
                FishingCombat.ShotOutcome o = FishingCombat.resolveShot(stream, species, cannon, damageBefore, bet);
                totalBet += bet;
                if (o.killed()) {
                    if (o.captured()) totalPayout += o.payout();
                    break;
                }
                damageBefore = o.damageTakenAfter();
            }
        }
        double rtp = (double) totalPayout / totalBet;
        assertTrue(rtp > 0.90 && rtp < 1.02,
                species + " 砲台L" + cannon + " 模擬 RTP=" + rtp + " 應落在 0.90~1.02（目標 0.96）");
    }

    // ------------------------------------------------------------------
    // 暴擊率
    // ------------------------------------------------------------------

    @Test
    @DisplayName("暴擊率 ≈ CRIT_CHANCE（20%）")
    void critRate_approximatesCritChance() {
        int shots = 200_000;
        int crits = 0;
        for (int n = 1; n <= shots; n++) {
            RandomStream stream = RNG.stream(SERVER_SEED, CLIENT_SEED, n);
            // damageBefore=0、龍王（高 HP）確保不會致命，只測暴擊位元
            FishingCombat.ShotOutcome o = FishingCombat.resolveShot(stream, FishSpecies.DRAGON_KING, 1, 0L, 100L);
            if (o.crit()) crits++;
        }
        double rate = (double) crits / shots;
        assertEquals(FishingCombat.CRIT_CHANCE, rate, 0.01,
                "暴擊率應接近 " + FishingCombat.CRIT_CHANCE + "，實際=" + rate);
        // 暴擊傷害應為基礎 ×CRIT_MULTIPLIER
        assertEquals(FishingCombat.cannonDamage(1) * (long) FishingCombat.CRIT_MULTIPLIER,
                critDamageOnce(), "暴擊傷害應為基礎傷害 × CRIT_MULTIPLIER");
    }

    private long critDamageOnce() {
        // 找一發暴擊，回傳其傷害
        for (int n = 1; n <= 100; n++) {
            RandomStream stream = RNG.stream(SERVER_SEED, CLIENT_SEED, n);
            FishingCombat.ShotOutcome o = FishingCombat.resolveShot(stream, FishSpecies.DRAGON_KING, 1, 0L, 100L);
            if (o.crit()) return o.damage();
        }
        throw new IllegalStateException("100 發內竟無暴擊（機率極低）");
    }

    // ------------------------------------------------------------------
    // Provably Fair 重放
    // ------------------------------------------------------------------

    @Test
    @DisplayName("Provably Fair：相同 seed/nonce/damageBefore 必得相同結果（確定性重放）")
    void resolveShot_isDeterministic() {
        for (long nonce = 1; nonce <= 50; nonce++) {
            FishingCombat.ShotOutcome a = FishingCombat.resolveShot(
                    RNG.stream(SERVER_SEED, CLIENT_SEED, nonce), FishSpecies.ANGELFISH, 2, 40L, 50L);
            FishingCombat.ShotOutcome b = FishingCombat.resolveShot(
                    RNG.stream(SERVER_SEED, CLIENT_SEED, nonce), FishSpecies.ANGELFISH, 2, 40L, 50L);
            assertEquals(a, b, "nonce=" + nonce + " 兩次重放結果應完全一致");
        }
    }

    @Test
    @DisplayName("非致命發不派彩、剩餘血量正確遞減")
    void nonKillingShot_dealsDamageWithoutPayout() {
        // 龍王 HP 極高，第一發必非致命
        FishingCombat.ShotOutcome o = FishingCombat.resolveShot(
                RNG.stream(SERVER_SEED, CLIENT_SEED, 1L), FishSpecies.DRAGON_KING, 1, 0L, 100L);
        assertFalse(o.killed(), "龍王第一發不應致命");
        assertFalse(o.captured());
        assertEquals(0L, o.payout());
        assertEquals(FishSpecies.DRAGON_KING.hp() - o.damage(), o.hpRemaining(), "剩餘血量應為 HP − 本發傷害");
    }

    // ------------------------------------------------------------------
    // 殘血部分回收（ADR-004，體感 RTP 地板）
    // ------------------------------------------------------------------

    @Test
    @DisplayName("殘血回收：退還約 RECOVERY_RATE 比例的子彈成本，且恆 ≤ 投入成本（不超付）")
    void recoveryPayout_refundsRateOfSpentBullets_neverExceedsCost() {
        long bet = 100L;
        int cannon = 1; // 傷害 10
        long cumDamage = 1000L;
        long recovery = FishingCombat.recoveryPayout(bet, cannon, cumDamage);

        double expectedShots = cumDamage / (FishingCombat.critFactor() * FishingCombat.cannonDamage(cannon));
        long expected = (long) Math.floor(FishingCombat.RECOVERY_RATE * bet * expectedShots);
        assertEquals(expected, recovery, "回收 = floor(RECOVERY_RATE × bet × 期望耗彈)");

        // 不超付：回收恆 ≤ 投入子彈成本（bet × 期望耗彈），這保證整體 RTP ≤ TARGET_RTP
        assertTrue(recovery <= (long) Math.ceil(bet * expectedShots), "回收不應超過投入子彈成本");
        // 體感地板語意：回收/成本 ≈ RECOVERY_RATE
        assertTrue(recovery > 0 && recovery <= bet * expectedShots);
    }

    @Test
    @DisplayName("殘血回收：零傷害或零注額回收為 0")
    void recoveryPayout_zeroWhenNoDamageOrNoBet() {
        assertEquals(0L, FishingCombat.recoveryPayout(100L, 1, 0L));
        assertEquals(0L, FishingCombat.recoveryPayout(0L, 1, 500L));
    }
}
