package com.luckystar.game.fishing;

import com.luckystar.game.rng.RandomStream;

/**
 * 捕魚機魚種賠率表（華人文化彩頭設計）。
 *
 * <p>每發子彈對單一目標魚做獨立判定：命中機率 = {@code TARGET_RTP / multiplier}，
 * 命中派彩 = {@code betPerShot * multiplier}。如此每發子彈的期望回報恆為
 * {@code TARGET_RTP}（92%），與魚種無關——玩家打高倍魚是高波動、打小魚是低波動，
 * 數學期望一致，無「某魚較划算」的漏洞。
 *
 * <p>搖錢樹（{@link #MONEY_TREE}）為特殊魚：命中後倍率在 [10, 50] 由同一條
 * {@link RandomStream} 抽出（期望 30，命中率以期望倍率折算），維持整體 RTP 一致。
 *
 * <p>判定順序固定為「先抽命中、再抽倍率（僅搖錢樹）」，且每發子彈使用
 * {@code nonce = shotSeq} 的獨立串流——確保事後可由 (serverSeed, clientSeed, shotSeq)
 * 重放驗證（Provably Fair，比照老虎機/百家樂）。
 */
public enum FishSpecies {

    // 小魚群：高命中率，LDW 主力（小額回收也有金幣音效）
    KOI("fish-koi", "錦鯉", 2),
    GOLDFISH("fish-goldfish", "金魚", 3),
    LANTERN("fish-lantern", "燈籠魚", 5),
    // 中型魚
    PUFFER("fish-puffer", "河豚", 8),
    ANGELFISH("fish-angelfish", "神仙魚", 15),
    DEVIL_RAY("fish-devil-ray", "魔鬼魚", 25),
    // 高倍與 Boss
    GOLD_DRAGON("fish-gold-dragon", "金龍", 60),
    PIXIU("fish-pixiu", "貔貅", 88),
    CAISHEN("fish-caishen", "財神爺", 100),
    DRAGON_KING("fish-dragon-king", "龍王", 200),
    // 特殊：搖錢樹（隨機 10~50 倍，期望 30）
    MONEY_TREE("fish-money-tree", "搖錢樹", 30);

    /** 設計 RTP（每發子彈期望回報率）。與老虎機/百家樂同屬產品可調常數。 */
    public static final double TARGET_RTP = 0.92d;

    /** 搖錢樹隨機倍率區間 [MIN, MAX]。 */
    static final int MONEY_TREE_MIN = 10;
    static final int MONEY_TREE_MAX = 50;

    /** 前端資源 id（對齊 frontend casino-fx registry）。 */
    private final String assetId;
    /** 中文顯示名。 */
    private final String displayName;
    /** 賠付倍率（搖錢樹為期望倍率，實際命中時隨機抽取）。 */
    private final int multiplier;

    FishSpecies(String assetId, String displayName, int multiplier) {
        this.assetId = assetId;
        this.displayName = displayName;
        this.multiplier = multiplier;
    }

    public String assetId() {
        return assetId;
    }

    public String displayName() {
        return displayName;
    }

    public int multiplier() {
        return multiplier;
    }

    /** 每發子彈的命中機率（= RTP / 倍率）。 */
    public double hitProbability() {
        return TARGET_RTP / multiplier;
    }

    /**
     * 以確定性隨機串流判定單發子彈的派彩（0 表示未命中）。
     *
     * <p>抽取順序固定：先 {@code nextDouble()} 判命中，搖錢樹命中後再以
     * {@code nextInt(41)} 抽實際倍率。相同 (serverSeed, clientSeed, nonce) 必得相同結果。
     *
     * @param stream     本發子彈的隨機串流（nonce = shotSeq）
     * @param betPerShot 單發子彈下注額
     * @return 派彩金額（含本金概念的總回收；0 = 未命中）
     */
    public long resolvePayout(RandomStream stream, long betPerShot) {
        boolean hit = stream.nextDouble() < hitProbability();
        if (!hit) {
            return 0L;
        }
        if (this == MONEY_TREE) {
            int rolled = MONEY_TREE_MIN + stream.nextInt(MONEY_TREE_MAX - MONEY_TREE_MIN + 1);
            return betPerShot * rolled;
        }
        return betPerShot * multiplier;
    }

    /**
     * 幸運值全滿保底命中：必中，跳過 {@code nextDouble()} 命中判定，直接計算派彩。
     * MONEY_TREE 仍以 {@code nextInt(41)} 隨機抽取實際倍率（維持高低倍刺激感）。
     *
     * @param stream     本發子彈的隨機串流（nonce = shotSeq）
     * @param betPerShot 單發子彈下注額
     * @return 派彩金額（必 > 0）
     */
    public long resolveGuaranteedPayout(RandomStream stream, long betPerShot) {
        if (this == MONEY_TREE) {
            int rolled = MONEY_TREE_MIN + stream.nextInt(MONEY_TREE_MAX - MONEY_TREE_MIN + 1);
            return betPerShot * rolled;
        }
        return betPerShot * multiplier;
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
