package com.luckystar.game.fishing;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.luckystar.game.rng.ProvablyFairRng;
import com.luckystar.game.rng.RandomStream;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * {@link FishSpecies} 的 PF 串流對齊驗證。
 *
 * <p>核心不變式：{@code resolveGuaranteedPayout} 消耗的 RNG 呼叫次數
 * 必須與 {@code resolvePayout}（命中路徑）完全相同，使 {@code verifyShot}
 * 端點可用相同串流位移重放並得到一致結果。
 */
class FishSpeciesTest {

    private static final ProvablyFairRng RNG = new ProvablyFairRng();
    private static final String SERVER_SEED = "test-server-seed-fixed";
    private static final String CLIENT_SEED = "test-client-seed";
    private static final long NONCE = 42L;
    private static final long BET = 100L;

    @Test
    @DisplayName("非搖錢樹：resolveGuaranteedPayout 消耗一次 nextDouble()，與 resolvePayout 命中路徑相同")
    void resolveGuaranteedPayout_nonMoneyTree_streamAlignedWithHitPath() {
        // s1：呼叫 resolveGuaranteedPayout 後，串流位置應移動 1 個 nextDouble()
        RandomStream s1 = RNG.stream(SERVER_SEED, CLIENT_SEED, NONCE);
        FishSpecies.KOI.resolveGuaranteedPayout(s1, BET);

        // s2：手動消耗相同呼叫（1 nextDouble = hit check）
        RandomStream s2 = RNG.stream(SERVER_SEED, CLIENT_SEED, NONCE);
        s2.nextDouble();

        // 兩條串流此後應完全對齊
        assertEquals(s2.nextInt(256), s1.nextInt(256),
                "KOI resolveGuaranteedPayout 後的串流位置應與消耗一次 nextDouble() 的路徑一致");
    }

    @Test
    @DisplayName("搖錢樹：resolveGuaranteedPayout 消耗 nextDouble() + nextInt(41)，與 resolvePayout 命中路徑相同")
    void resolveGuaranteedPayout_moneyTree_streamAlignedWithHitPath() {
        // s1：呼叫 resolveGuaranteedPayout 後，應消耗 nextDouble() + nextInt(41)
        RandomStream s1 = RNG.stream(SERVER_SEED, CLIENT_SEED, NONCE);
        long payout = FishSpecies.MONEY_TREE.resolveGuaranteedPayout(s1, BET);

        // s2：模擬 resolvePayout 命中路徑（nextDouble 命中 → nextInt(41) 取倍率）
        RandomStream s2 = RNG.stream(SERVER_SEED, CLIENT_SEED, NONCE);
        s2.nextDouble();          // hit check（忽略結果）
        int rolled = FishSpecies.MONEY_TREE_MIN + s2.nextInt(FishSpecies.MONEY_TREE_MAX - FishSpecies.MONEY_TREE_MIN + 1);

        // 派彩應與手動重算一致（保底必中，倍率 = rolled）
        assertEquals(BET * rolled, payout,
                "MONEY_TREE resolveGuaranteedPayout 派彩應與以相同串流手動計算的倍率一致");

        // 此後串流應完全對齊
        assertEquals(s2.nextInt(256), s1.nextInt(256),
                "MONEY_TREE resolveGuaranteedPayout 後的串流位置應與消耗 nextDouble()+nextInt(41) 的路徑一致");
    }

    @Test
    @DisplayName("resolveGuaranteedPayout 對所有魚種必回傳 > 0 的派彩")
    void resolveGuaranteedPayout_allSpecies_alwaysPositive() {
        for (FishSpecies species : FishSpecies.values()) {
            RandomStream stream = RNG.stream(SERVER_SEED, CLIENT_SEED, NONCE);
            long payout = species.resolveGuaranteedPayout(stream, BET);
            assertTrue(payout > 0,
                    "resolveGuaranteedPayout 對 " + species.name() + " 應回傳 > 0，實際=" + payout);
        }
    }
}
