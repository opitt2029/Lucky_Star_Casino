package com.luckystar.game.fishing;

/**
 * 捕魚機魚種定義（華人文化彩頭設計）。
 *
 * <p><b>血量/傷害模型（ADR-003）</b>：每條魚有 {@link #hp() HP}；每發子彈依砲台造成傷害並
 * 累積，血量歸零的那一發是「致命一擊」，致命一擊時擲一次捕獲判定 {@code pCapture} 決定派彩
 * 或掙脫逃跑。命中派彩 = {@code betPerShot × multiplier}（搖錢樹為隨機倍率）。
 *
 * <p>HP 與倍率成正比（{@code hp = multiplier × }{@value #HP_PER_MULTIPLIER}），使銅炮的
 * 期望擊殺發數 ≈ 倍率（錦鯉 ~2 發、河豚 ~8 發、金龍 ~60 發、龍王 ~200 發）。實際的捕獲機率
 * {@code pCapture} 由 {@link FishingCombat} 依各魚種/砲台的「期望擊殺發數」反推，使每發子彈的
 * 期望回報恆為 {@link FishingCombat#TARGET_RTP}——與魚種、砲台皆無關，無「某魚/某砲較划算」
 * 的套利漏洞。RNG（暴擊、捕獲、搖錢樹倍率）皆由 (serverSeed, clientSeed, nonce=shotSeq) 確定性
 * 重放（Provably Fair，比照老虎機/百家樂）。
 *
 * <p>此 enum 僅為「純資料」：戰鬥判定（暴擊/累傷/致命/捕獲/派彩）一律在 {@link FishingCombat}，
 * 以利單元測試與 RTP 模擬。
 */
public enum FishSpecies {

    // 小魚群：高命中率、群游，LDW 小額回收主力
    KOI("fish-koi", "錦鯉", 2, Tier.SMALL, 100),
    GOLDFISH("fish-goldfish", "金魚", 3, Tier.SMALL, 90),
    LANTERN("fish-lantern", "燈籠魚", 5, Tier.SMALL, 70),
    // 中型魚
    PUFFER("fish-puffer", "河豚", 8, Tier.MEDIUM, 50),
    ANGELFISH("fish-angelfish", "神仙魚", 15, Tier.MEDIUM, 35),
    DEVIL_RAY("fish-devil-ray", "魔鬼魚", 25, Tier.MEDIUM, 22),
    // 高倍魚
    GOLD_DRAGON("fish-gold-dragon", "金龍", 60, Tier.HIGH, 12),
    PIXIU("fish-pixiu", "貔貅", 88, Tier.HIGH, 7),
    CAISHEN("fish-caishen", "財神爺", 100, Tier.HIGH, 6),
    // Boss
    DRAGON_KING("fish-dragon-king", "龍王", 200, Tier.BOSS, 2),
    // 特殊：搖錢樹（捕獲時隨機 10~50 倍，期望 30）
    MONEY_TREE("fish-money-tree", "搖錢樹", 30, Tier.SPECIAL, 5);

    /** 魚種分級（驅動體型/游速/視覺/出現節奏；前端渲染與 Boss 事件依此分流）。 */
    public enum Tier {
        SMALL, MEDIUM, HIGH, BOSS, SPECIAL
    }

    /** 每倍率對應的 HP 量（HP = multiplier × 此值）。與砲台基礎傷害同數量級，使銅炮擊殺發數 ≈ 倍率。 */
    public static final int HP_PER_MULTIPLIER = 10;

    /** 搖錢樹隨機倍率區間 [MIN, MAX]（期望 30）。 */
    public static final int MONEY_TREE_MIN = 10;
    public static final int MONEY_TREE_MAX = 50;

    private final String assetId;
    private final String displayName;
    private final int multiplier;
    private final Tier tier;
    private final int spawnWeight;
    private final long hp;

    FishSpecies(String assetId, String displayName, int multiplier, Tier tier, int spawnWeight) {
        this.assetId = assetId;
        this.displayName = displayName;
        this.multiplier = multiplier;
        this.tier = tier;
        this.spawnWeight = spawnWeight;
        this.hp = (long) multiplier * HP_PER_MULTIPLIER;
    }

    public String assetId() {
        return assetId;
    }

    public String displayName() {
        return displayName;
    }

    /** 賠付倍率（搖錢樹為期望倍率，實際捕獲時隨機抽取）。 */
    public int multiplier() {
        return multiplier;
    }

    public Tier tier() {
        return tier;
    }

    /** 出現權重（前端 spawn director 與後端參考用；倍率越高越稀有）。 */
    public int spawnWeight() {
        return spawnWeight;
    }

    /** 魚的總血量（傷害累積達此值的那一發為致命一擊）。 */
    public long hp() {
        return hp;
    }

    public boolean isMoneyTree() {
        return this == MONEY_TREE;
    }

    /**
     * 由 API 傳入的魚種代碼（enum 名稱，大小寫不拘）解析魚種。
     *
     * @throws IllegalArgumentException 代碼不存在
     */
    public static FishSpecies fromCode(String code) {
        if (code == null || code.isBlank()) {
            throw new IllegalArgumentException("缺少魚種代碼 fishType");
        }
        try {
            return FishSpecies.valueOf(code.trim().toUpperCase());
        } catch (IllegalArgumentException ex) {
            throw new IllegalArgumentException("不支援的魚種: " + code);
        }
    }
}
