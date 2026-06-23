package com.luckystar.game.fishing;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * {@link FishSpecies} 純資料定義驗證（血量/傷害模型，ADR-003）。
 * 戰鬥數學（暴擊/捕獲/RTP）見 {@link FishingCombatTest}。
 */
class FishSpeciesTest {

    @Test
    @DisplayName("HP = 倍率 × HP_PER_MULTIPLIER")
    void hp_isMultiplierTimesPerMultiplier() {
        for (FishSpecies species : FishSpecies.values()) {
            assertEquals((long) species.multiplier() * FishSpecies.HP_PER_MULTIPLIER, species.hp(),
                    species + " 的 HP 應為 倍率 × " + FishSpecies.HP_PER_MULTIPLIER);
        }
    }

    @Test
    @DisplayName("每個魚種都有 tier 與正的出現權重")
    void everySpecies_hasTierAndPositiveSpawnWeight() {
        for (FishSpecies species : FishSpecies.values()) {
            assertNotNull(species.tier(), species + " 應有 tier");
            assertTrue(species.spawnWeight() > 0, species + " 出現權重應為正");
        }
    }

    @Test
    @DisplayName("出現權重與倍率負相關：小魚比 Boss 常見")
    void spawnWeight_inverselyRelatedToMultiplier() {
        assertTrue(FishSpecies.KOI.spawnWeight() > FishSpecies.GOLD_DRAGON.spawnWeight(),
                "錦鯉應比金龍常見");
        assertTrue(FishSpecies.GOLD_DRAGON.spawnWeight() > FishSpecies.DRAGON_KING.spawnWeight(),
                "金龍應比龍王常見");
    }

    @Test
    @DisplayName("tier 分級正確（小/中/高/Boss/特殊）")
    void tier_assignments() {
        assertEquals(FishSpecies.Tier.SMALL, FishSpecies.KOI.tier());
        assertEquals(FishSpecies.Tier.MEDIUM, FishSpecies.PUFFER.tier());
        assertEquals(FishSpecies.Tier.HIGH, FishSpecies.CAISHEN.tier());
        assertEquals(FishSpecies.Tier.BOSS, FishSpecies.DRAGON_KING.tier());
        assertEquals(FishSpecies.Tier.SPECIAL, FishSpecies.MONEY_TREE.tier());
        assertTrue(FishSpecies.MONEY_TREE.isMoneyTree());
    }

    @Test
    @DisplayName("fromCode 大小寫不拘；不存在的代碼丟例外")
    void fromCode_caseInsensitive_andRejectsUnknown() {
        assertEquals(FishSpecies.DRAGON_KING, FishSpecies.fromCode("dragon_king"));
        assertEquals(FishSpecies.KOI, FishSpecies.fromCode("  KOI "));
        assertThrows(IllegalArgumentException.class, () -> FishSpecies.fromCode("UNKNOWN_FISH"));
        assertThrows(IllegalArgumentException.class, () -> FishSpecies.fromCode(" "));
    }
}
