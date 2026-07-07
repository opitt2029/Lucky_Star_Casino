package com.luckystar.game.baccarat;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.luckystar.game.fishing.FishSpecies;
import com.luckystar.game.fishing.FishingCombat;
import com.luckystar.game.slot.SlotSymbol;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HashSet;
import java.util.Set;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * 玩法契約相等性守門測試（Phase 5）：repo 根 {@code contracts/*.json} 逐欄斷言＝後端 enum/常數。
 *
 * <p><b>單一真相仍是後端程式碼</b>（enum 承載 Javadoc 理論 RTP 與雷區 15/16 的測試守門），JSON 是
 * 給前端 mock（{@code frontend/src/services/mockApi.js} 直接 import）與文件用的鏡像；本測試保證
 * 兩者相等——任何一邊漂移＝CI 紅燈。改玩法數值：先改後端、再同步 JSON、跑
 * {@code mvn -pl backend/game-service test}。
 *
 * <p>類別放在 {@code baccarat} 套件是為了直接呼叫 package-private 的
 * {@link BaccaratGameService#bankerDraws}（老虎機/捕魚的契約走 public API，不受套件位置影響）。
 * {@code contracts/shop-catalog.json} 僅供 mock（正式目錄在 MySQL，雷區 20），不在守門範圍。
 */
class ContractParityTest {

    /** surefire 工作目錄＝模組根（backend/game-service），contracts 在 repo 根。 */
    private static final Path CONTRACTS_DIR = Path.of("..", "..", "contracts");

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private static JsonNode readContract(String fileName) throws IOException {
        Path path = CONTRACTS_DIR.resolve(fileName);
        assertTrue(Files.exists(path), "找不到契約檔（應在 repo 根 contracts/）: " + path.toAbsolutePath());
        return MAPPER.readTree(path.toFile());
    }

    @Test
    @DisplayName("slot-paytable.json 與 SlotSymbol 逐欄相等（順序、display、權重、兩階倍率、總權重）")
    void slotPaytable_matchesSlotSymbol() throws IOException {
        JsonNode json = readContract("slot-paytable.json");
        JsonNode symbols = json.get("symbols");

        SlotSymbol[] values = SlotSymbol.values();
        assertEquals(values.length, symbols.size(), "符號數量不一致");
        for (int i = 0; i < values.length; i++) {
            SlotSymbol expected = values[i];
            JsonNode actual = symbols.get(i);
            assertEquals(expected.name(), actual.get("code").asText(), "第 " + i + " 個符號 code");
            assertEquals(expected.display(), actual.get("display").asText(), expected + " display");
            assertEquals(expected.weight(), actual.get("weight").asInt(), expected + " weight");
            assertEquals(expected.pairMultiplier(), actual.get("pairMultiplier").asInt(),
                    expected + " pairMultiplier");
            assertEquals(expected.tripleMultiplier(), actual.get("tripleMultiplier").asInt(),
                    expected + " tripleMultiplier");
        }
        assertEquals(SlotSymbol.TOTAL_WEIGHT, json.get("totalWeight").asInt(), "totalWeight");
    }

    @Test
    @DisplayName("baccarat-rules.json 與 BaccaratGameService 相等（和局賠率、傭金、莊家補牌表全域窮舉）")
    void baccaratRules_matchBaccaratGameService() throws IOException {
        JsonNode json = readContract("baccarat-rules.json");

        assertEquals(BaccaratGameService.TIE_PAYOUT_RATIO, json.get("tiePayoutRatio").asLong(),
                "tiePayoutRatio");
        assertEquals(BaccaratGameService.BANKER_COMMISSION_RATE,
                json.get("bankerCommissionRate").asDouble(), 0.0d, "bankerCommissionRate");

        JsonNode draws = json.get("bankerDraws");

        // 閒家未補牌：莊點 ≤ whenPlayerStandsDrawOnMax 即補
        int standMax = draws.get("whenPlayerStandsDrawOnMax").asInt();
        for (int bankerScore = 0; bankerScore <= 7; bankerScore++) {
            assertEquals(bankerScore <= standMax,
                    BaccaratGameService.bankerDraws(bankerScore, null),
                    "閒家未補牌、莊點 " + bankerScore + " 的補牌判定");
        }

        // 閒家補了第三張：對莊點 0~7 × 第三張值 0~9 全域窮舉比對查表結果
        JsonNode byScore = draws.get("byBankerScore");
        assertEquals(8, byScore.size(), "byBankerScore 應涵蓋莊點 0~7");
        for (int bankerScore = 0; bankerScore <= 7; bankerScore++) {
            Set<Integer> drawValues = new HashSet<>();
            for (JsonNode v : byScore.get(String.valueOf(bankerScore))) {
                drawValues.add(v.asInt());
            }
            for (int p3 = 0; p3 <= 9; p3++) {
                assertEquals(drawValues.contains(p3),
                        BaccaratGameService.bankerDraws(bankerScore, p3),
                        "莊點 " + bankerScore + "、閒家第三張值 " + p3 + " 的補牌判定");
            }
        }
    }

    @Test
    @DisplayName("fishing-species.json 與 FishSpecies 逐欄相等（順序、名稱、倍率、分級、出現權重、HP 係數、搖錢樹區間）")
    void fishingSpecies_matchesFishSpecies() throws IOException {
        JsonNode json = readContract("fishing-species.json");

        assertEquals(FishSpecies.HP_PER_MULTIPLIER, json.get("hpPerMultiplier").asInt(),
                "hpPerMultiplier");
        assertEquals(FishSpecies.MONEY_TREE_MIN, json.get("moneyTreeMultiplier").get("min").asInt(),
                "moneyTreeMultiplier.min");
        assertEquals(FishSpecies.MONEY_TREE_MAX, json.get("moneyTreeMultiplier").get("max").asInt(),
                "moneyTreeMultiplier.max");

        JsonNode species = json.get("species");
        FishSpecies[] values = FishSpecies.values();
        assertEquals(values.length, species.size(), "魚種數量不一致");
        for (int i = 0; i < values.length; i++) {
            FishSpecies expected = values[i];
            JsonNode actual = species.get(i);
            assertEquals(expected.name(), actual.get("code").asText(), "第 " + i + " 個魚種 code");
            assertEquals(expected.displayName(), actual.get("displayName").asText(),
                    expected + " displayName");
            assertEquals(expected.assetId(), actual.get("assetId").asText(), expected + " assetId");
            assertEquals(expected.multiplier(), actual.get("multiplier").asInt(),
                    expected + " multiplier");
            assertEquals(expected.tier().name(), actual.get("tier").asText(), expected + " tier");
            assertEquals(expected.spawnWeight(), actual.get("spawnWeight").asInt(),
                    expected + " spawnWeight");
        }
    }

    @Test
    @DisplayName("fishing-combat.json 與 FishingCombat 常數相等（RTP、回收率、暴擊、砲台傷害表）")
    void fishingCombat_matchesFishingCombat() throws IOException {
        JsonNode json = readContract("fishing-combat.json");

        assertEquals(FishingCombat.TARGET_RTP, json.get("targetRtp").asDouble(), 0.0d, "targetRtp");
        assertEquals(FishingCombat.RECOVERY_RATE, json.get("recoveryRate").asDouble(), 0.0d,
                "recoveryRate");
        assertEquals(FishingCombat.CRIT_CHANCE, json.get("critChance").asDouble(), 0.0d,
                "critChance");
        assertEquals(FishingCombat.CRIT_MULTIPLIER, json.get("critMultiplier").asInt(),
                "critMultiplier");

        JsonNode cannonDamage = json.get("cannonDamage");
        assertEquals(0, cannonDamage.get(0).asInt(), "cannonDamage[0] 為占位、應為 0");
        for (int level = 1; level < cannonDamage.size(); level++) {
            assertEquals(FishingCombat.cannonDamage(level), cannonDamage.get(level).asInt(),
                    "砲台等級 " + level + " 傷害");
        }
        // 等級數量也要相等：JSON 最後一級之外的等級，後端必須同樣不支援
        int firstUnsupported = cannonDamage.size();
        assertThrows(IllegalArgumentException.class,
                () -> FishingCombat.cannonDamage(firstUnsupported),
                "後端支援的砲台等級多於 JSON（等級 " + firstUnsupported + " 未列入契約）");
    }
}
