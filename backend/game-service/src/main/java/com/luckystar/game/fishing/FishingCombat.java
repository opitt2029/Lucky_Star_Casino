package com.luckystar.game.fishing;

import com.luckystar.game.rng.RandomStream;
import java.util.EnumMap;
import java.util.Map;

/**
 * 捕魚機戰鬥數學（血量/傷害模型核心，ADR-003）。純函式、無狀態，便於單元測試與 RTP 模擬。
 *
 * <h3>單發判定流程（nonce = shotSeq 的串流，確定性可重放）</h3>
 * <ol>
 *   <li><b>暴擊</b>：{@code stream.nextDouble() < }{@value #CRIT_CHANCE} → 傷害 ×{@value #CRIT_MULTIPLIER}。</li>
 *   <li><b>累積傷害</b>：{@code damageTakenAfter = damageTakenBefore + damage}。</li>
 *   <li>未達 HP → 還沒死（{@code payout = 0}，照常扣注）。</li>
 *   <li>達 HP（致命一擊）→ 再擲<b>捕獲</b> {@code stream.nextDouble() < pCapture(species, cannon)}：
 *       捕獲則 {@code payout = bet × multiplier}（搖錢樹再 {@code nextInt} 抽 10~50 倍）；否則掙脫逃跑（0）。</li>
 * </ol>
 *
 * <h3>為什麼 RTP 恆為 {@value #TARGET_RTP}（與魚種/砲台無關）</h3>
 * <p>每條魚恰好一次捕獲判定（在第 N 發致命一擊），故
 * {@code RTP = pCapture × multiplier × bet / (E[N] × bet) = pCapture × multiplier / E[N]}。
 * 我們以 {@link #expectedShotsToKill} 精確算出 {@code E[N]}（含暴擊加速、離散溢出），再令
 * {@code pCapture = TARGET_RTP × E[N] / multiplier}，使每魚種/砲台的 RTP 精確等於目標值
 * （搖錢樹以期望倍率 30 計，隨機 10~50 的期望一致）。{@code pCapture} 受 [0,1] 夾限——HP 已設計成
 * 不會觸頂（{@code E[N] ≤ multiplier/TARGET_RTP}）。
 *
 * <p><b>注意</b>：上述為「玩家把每條鎖定的魚都打到死」的設計 RTP；實戰中大魚常在游出畫面前未打死
 * （已投入子彈成本損失），使<i>淨 RTP 略低於</i> {@value #TARGET_RTP}（對莊家安全），由 admin RTP
 * 監控（T-105/106）線上觀測、必要時調整本檔常數。詳見 ADR-003 / ADR-004。
 *
 * <p><b>殘血部分回收（ADR-004）</b>：{@link com.luckystar.game.service.FishingService} 結算時，對
 * 「受傷但未打死」的魚按已造成傷害換算的期望耗彈成本退還 {@value #RECOVERY_RATE} 比例（見
 * {@link #recoveryPayout}）。這把「子彈打在最後逃走的魚上＝全損」的沉沒成本變成部分回收，使每發子彈的
 * 期望回報被夾在 {@code [RECOVERY_RATE, TARGET_RTP]}＝<b>體感 RTP 地板 {@value #RECOVERY_RATE}、天花板
 * {@value #TARGET_RTP}</b>：回收永遠 ≤ 打死路徑派彩，故不會讓整體 RTP 超過設計值（莊家安全），但保證玩家
 * 最差體感也只虧 {@code 1 − RECOVERY_RATE}。
 */
public final class FishingCombat {

    private FishingCombat() {
    }

    /** 設計 RTP（每發子彈期望回報率＝體感 RTP 天花板）。與老虎機/百家樂同屬產品可調常數。 */
    public static final double TARGET_RTP = 0.96d;

    /** 殘血部分回收率（受傷未死的魚在結算時退還的子彈成本比例＝體感 RTP 地板，ADR-004）。 */
    public static final double RECOVERY_RATE = 0.70d;

    /** 暴擊機率。 */
    public static final double CRIT_CHANCE = 0.20d;

    /** 暴擊傷害倍率（暴擊扣更多血、擊殺更快）。 */
    public static final int CRIT_MULTIPLIER = 2;

    /**
     * 各砲台等級的單發基礎傷害（索引 0 不用）。
     * 銅 10 / 銀 14 / 金 18——傷害差距刻意收斂（金炮約銅炮 1.8×）：金炮速殺但不致把中小魚 HP 壓到「1~2 發秒殺」，
     * 使最低捕獲率不致過低（金炮對中小魚 {@code pCapture} ≈ 0.44，避免「血歸零卻掙脫」過於頻繁），
     * RTP 仍由 {@code pCapture} 補償一致。注額已與砲台解耦（玩家自選），砲台只決定火力/節奏/變異度。
     */
    private static final int[] CANNON_DAMAGE = {0, 10, 14, 18};

    /** 預先算好的捕獲機率表：species → [cannonLevel] → pCapture。 */
    private static final Map<FishSpecies, double[]> P_CAPTURE = buildCaptureTable();

    /** 單發判定結果。 */
    public record ShotOutcome(
            boolean crit,
            long damage,
            long damageTakenAfter,
            long hpRemaining,
            boolean killed,
            boolean captured,
            long payout) {
    }

    /** 砲台單發基礎傷害（不含暴擊）。 */
    public static int cannonDamage(int cannonLevel) {
        if (cannonLevel < 1 || cannonLevel >= CANNON_DAMAGE.length) {
            throw new IllegalArgumentException("不支援的砲台等級: " + cannonLevel);
        }
        return CANNON_DAMAGE[cannonLevel];
    }

    /** 暴擊加成因子：{@code 1 + CRIT_CHANCE × (CRIT_MULTIPLIER − 1)}。 */
    public static double critFactor() {
        return 1.0d + CRIT_CHANCE * (CRIT_MULTIPLIER - 1);
    }

    /**
     * 殘血部分回收派彩（ADR-004）：對「受傷但未打死」的魚，按已造成傷害換算的期望耗彈成本退還
     * {@value #RECOVERY_RATE} 比例。
     *
     * <p>期望耗彈 {@code ≈ cumDamage / (critFactor × 砲台基礎傷害)}（critFactor 還原暴擊讓每發平均多扣的血），
     * 故回收 {@code = floor(RECOVERY_RATE × betPerShot × 期望耗彈)}＝「你打在這條逃走的魚上、約 RECOVERY_RATE
     * 比例的子彈成本退回」。回收恆 ≤ 投入成本，使整體 RTP 不超過 {@value #TARGET_RTP}（見類別 Javadoc）。
     *
     * @param betPerShot  該場單發注額（玩家進場選定）
     * @param cannonLevel 砲台等級（決定基礎傷害）
     * @param cumDamage   結算時該魚已累積、尚未致命的傷害
     */
    public static long recoveryPayout(long betPerShot, int cannonLevel, long cumDamage) {
        if (cumDamage <= 0 || betPerShot <= 0) {
            return 0L;
        }
        double expectedShots = cumDamage / (critFactor() * cannonDamage(cannonLevel));
        return (long) Math.floor(RECOVERY_RATE * betPerShot * expectedShots);
    }

    /** 指定魚種/砲台的捕獲機率（致命一擊時擲中即派彩）。 */
    public static double pCapture(FishSpecies species, int cannonLevel) {
        double[] byLevel = P_CAPTURE.get(species);
        if (byLevel == null || cannonLevel < 1 || cannonLevel >= byLevel.length) {
            throw new IllegalArgumentException("無 pCapture：species=" + species + " cannon=" + cannonLevel);
        }
        return byLevel[cannonLevel];
    }

    /**
     * 期望擊殺發數 {@code E[N]}：每發傷害為 {@code damage}（暴擊則 {@code 2×damage}），
     * 累積首次達 {@code hp} 的期望發數。以「傷害單位」DP 精確求解（含離散溢出）。
     *
     * <p>令 {@code U = ceil(hp/damage)}：每發 +1 單位（機率 {@code 1−CRIT_CHANCE}）或 +2 單位
     * （機率 {@code CRIT_CHANCE}）。{@code 達 U 單位 ⟺ 原始傷害 ≥ hp}，故單位 DP 與原始等價。
     */
    public static double expectedShotsToKill(long hp, int damage) {
        if (hp <= 0) {
            return 0d;
        }
        int units = (int) ((hp + damage - 1) / damage); // ceil(hp/damage)
        // g[u] = 從 u 單位起、達 >= units 單位的期望發數；g[units] = g[units+1] = 0
        double[] g = new double[units + 2];
        for (int u = units - 1; u >= 0; u--) {
            g[u] = 1.0d + (1.0d - CRIT_CHANCE) * g[u + 1] + CRIT_CHANCE * g[u + 2];
        }
        return g[0];
    }

    /**
     * 解析單發子彈（一般路徑：致命一擊時依 {@code pCapture} 擲捕獲）。
     *
     * @param stream             本發子彈的隨機串流（nonce = shotSeq）
     * @param species            目標魚種
     * @param cannonLevel        砲台等級
     * @param damageTakenBefore  本發之前該魚已累積的傷害
     * @param betPerShot         單發下注額
     */
    public static ShotOutcome resolveShot(RandomStream stream, FishSpecies species, int cannonLevel,
                                          long damageTakenBefore, long betPerShot) {
        return resolve(stream, species, cannonLevel, damageTakenBefore, betPerShot, false);
    }

    /**
     * 幸運值保底：致命一擊<b>強制捕獲</b>（仍消耗捕獲判定的 RNG，使串流位置與一般路徑對齊，
     * verifyShot 可正確重放）。非致命發與 {@link #resolveShot} 完全相同。
     */
    public static ShotOutcome resolveShotGuaranteed(RandomStream stream, FishSpecies species, int cannonLevel,
                                                    long damageTakenBefore, long betPerShot) {
        return resolve(stream, species, cannonLevel, damageTakenBefore, betPerShot, true);
    }

    private static ShotOutcome resolve(RandomStream stream, FishSpecies species, int cannonLevel,
                                       long damageTakenBefore, long betPerShot, boolean forceCapture) {
        boolean crit = stream.nextDouble() < CRIT_CHANCE;
        long damage = (long) cannonDamage(cannonLevel) * (crit ? CRIT_MULTIPLIER : 1);
        long after = damageTakenBefore + damage;
        long hp = species.hp();

        if (after < hp) {
            // 還沒死：照常扣注、不派彩
            return new ShotOutcome(crit, damage, after, hp - after, false, false, 0L);
        }

        // 致命一擊：擲捕獲（保底則強制成功，但仍消耗同一個 nextDouble 對齊串流）
        boolean captureRoll = stream.nextDouble() < pCapture(species, cannonLevel);
        boolean captured = forceCapture || captureRoll;
        if (!captured) {
            return new ShotOutcome(crit, damage, after, 0L, true, false, 0L);
        }
        long payout = capturePayout(stream, species, betPerShot);
        return new ShotOutcome(crit, damage, after, 0L, true, true, payout);
    }

    /** 捕獲派彩：搖錢樹隨機 10~50 倍（再抽一次 RNG），其餘為固定倍率。 */
    private static long capturePayout(RandomStream stream, FishSpecies species, long betPerShot) {
        if (species.isMoneyTree()) {
            int rolled = FishSpecies.MONEY_TREE_MIN
                    + stream.nextInt(FishSpecies.MONEY_TREE_MAX - FishSpecies.MONEY_TREE_MIN + 1);
            return betPerShot * rolled;
        }
        return betPerShot * species.multiplier();
    }

    private static Map<FishSpecies, double[]> buildCaptureTable() {
        Map<FishSpecies, double[]> table = new EnumMap<>(FishSpecies.class);
        for (FishSpecies species : FishSpecies.values()) {
            double[] byLevel = new double[CANNON_DAMAGE.length];
            for (int level = 1; level < CANNON_DAMAGE.length; level++) {
                double expectedShots = expectedShotsToKill(species.hp(), CANNON_DAMAGE[level]);
                double p = TARGET_RTP * expectedShots / species.multiplier();
                byLevel[level] = Math.min(1.0d, p);
            }
            table.put(species, byLevel);
        }
        return table;
    }
}
