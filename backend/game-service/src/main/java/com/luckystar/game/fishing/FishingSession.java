package com.luckystar.game.fishing;

import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * 捕魚機場次 Session（buy-in 制 + 批次結算的核心狀態）。
 *
 * <p>捕魚是高頻射擊遊戲，不可能每發子彈打一次 wallet。設計為：
 * <ol>
 *   <li>{@code start}：一次性向 wallet 冪等扣 {@code buyIn}，金額轉入 {@code sessionBalance}（局內餘額）。</li>
 *   <li>{@code shots}：每批子彈只動 Redis 的 {@code sessionBalance}（扣注/加派彩），不打 wallet。</li>
 *   <li>{@code end}：把剩餘 {@code sessionBalance} 冪等 credit 回 wallet。</li>
 * </ol>
 *
 * <p>儲存於 Redis Hash，Key：{@code game:fishing:session:{playerId}}（每位玩家同時最多一個
 * 進行中場次）。TTL 為長效安全網（24h），實際閒置回收由排程在閒置 10 分鐘後自動結算
 * （把錢還回 wallet），確保「斷線錢不見」不會發生。
 *
 * <p><b>多人同台預留</b>：{@code roomId} / {@code seatIndex} 已在欄位與 API DTO 預留。
 * 單人版固定 {@code roomId = "solo-" + sessionId}、{@code seatIndex = 0}；
 * 未來多人版以真實房間 id 分組廣播即可，不需改帳務模型。
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class FishingSession {

    /** 場次唯一識別碼（UUID），亦作為 game_rounds.round_id（彙總一場一筆）。 */
    private String sessionId;

    private Long playerId;

    /** 房間 id（多人同台預留；單人版為 solo-{sessionId}）。 */
    private String roomId;

    /** 座位索引 0~3（多人同台預留；單人版固定 0）。 */
    private Integer seatIndex;

    /** 炮台等級 1~3（決定火力/擊殺速度/變異度與射速上限；注額已與砲台解耦，見 {@link #betPerShot}）。 */
    private Integer cannonLevel;

    /** 子彈面額（單發注額）：玩家進場自選、整場固定，與砲台解耦（ADR-004）。 */
    private Long betPerShot;

    /** 帶入金額（start 時自 wallet 一次性扣款）。 */
    private Long buyIn;

    /** 投注前錢包餘額（start 扣 buyIn 前），結算落地對局時寫入 game_rounds 供注單稽核。 */
    private Long balanceBefore;

    /** 局內餘額：buyIn − 累計子彈下注 + 累計派彩。end 時 credit 回 wallet。 */
    private Long sessionBalance;

    /** 累計子彈下注總額（RTP 統計分母）。 */
    private Long totalBet;

    /** 累計派彩總額（RTP 統計分子）。 */
    private Long totalPayout;

    /** 累計射擊發數。 */
    private Long totalShots;

    /** 已受理的最大 shotSeq（批次必須嚴格遞增，防重放）。 */
    private Long lastShotSeq;

    /** Provably Fair：保密 server seed（end 時揭露）。 */
    private String serverSeed;

    /** Provably Fair：開場即公布的承諾雜湊。 */
    private String serverSeedHash;

    private String clientSeed;

    /** ACTIVE / SETTLED。 */
    private String state;

    private Instant createdAt;

    /** 最後一次受理批次的時間（射速防刷與閒置回收依據）。 */
    private Instant lastActivityAt;

    /** 場次中是否有任何批次曾被風控攔截（verifyShot 警示用）。 */
    private Boolean intercepted;

    /**
     * 血量/傷害模型：每條魚 instance（key = 前端產生的 fishInstanceId）目前已累積的傷害。
     * 致命一擊（累傷達 HP）後該 entry 移除。並存上限由 {@code FishingService} 控管以防灌量。
     */
    @Builder.Default
    private Map<String, Long> fishDamage = new LinkedHashMap<>();

    /** Residual recovery accrued per fish instance when ammo/cannon can change during a round. */
    @Builder.Default
    private Map<String, Long> fishRecovery = new LinkedHashMap<>();

    /**
     * 致命一擊紀錄（供結算後 verifyShot 精確重放）：記錄每次「血量歸零」那一發的
     * shotSeq、魚種與該發之前的累積傷害（damageBefore）。
     */
    @Builder.Default
    private List<KillRecord> kills = new ArrayList<>();

    /** Idempotency keys for in-session top-up requests. */
    @Builder.Default
    private List<String> topUpRequestIds = new ArrayList<>();

    public boolean isActive() {
        return "ACTIVE".equals(state);
    }

    /** 致命一擊紀錄（Redis/JSON 可序列化）。 */
    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    public static class KillRecord {
        private long shotSeq;
        private String fishType;
        /** 該致命一擊之前該魚已累積的傷害（verifyShot 用以對齊判定）。 */
        private long damageBefore;
        /** Cannon level used by the killing shot; needed when ammo can change mid-round. */
        private int cannonLevel;
    }
}
