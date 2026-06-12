package com.luckystar.game.dto;

import java.util.List;
import lombok.Builder;
import lombok.Value;

/**
 * 捕魚機場次檢視（start / active 共用回應）。
 *
 * <p>{@code roomId} / {@code seatIndex} 為多人同台預留欄位：單人版固定
 * {@code solo-{sessionId}} / 0，前端據此渲染 4 座位房（其餘座位由機器人填充）。
 */
@Value
@Builder
public class FishingSessionView {

    String sessionId;
    String roomId;
    Integer seatIndex;
    Integer cannonLevel;
    Long buyIn;
    /** 局內餘額（buy-in − 累計下注 + 累計派彩）。 */
    Long sessionBalance;
    Long totalShots;
    /** 已受理的最大 shotSeq；續玩時前端從 lastShotSeq + 1 繼續編號。 */
    Long lastShotSeq;
    /** Provably Fair 承諾雜湊（serverSeed 於結算時揭露）。 */
    String serverSeedHash;
    String clientSeed;
    /** 是否為續玩（start 時已有進行中場次 → 直接回傳原場次，不重複扣款）。 */
    boolean resumed;
    /** 錢包餘額（start 扣款後）；active 查詢時可為 null。 */
    WalletView wallet;
    /** 魚種賠率表（前端渲染用）。 */
    List<FishTableEntry> fishTable;

    /** 單一魚種的賠率表項目。 */
    @Value
    @Builder
    public static class FishTableEntry {
        String code;
        String name;
        /** 前端 casino-fx registry 的資源 id。 */
        String assetId;
        int multiplier;
        /** 命中機率（= RTP / 倍率），前端顯示與動畫節奏參考。 */
        double hitProbability;
    }
}
