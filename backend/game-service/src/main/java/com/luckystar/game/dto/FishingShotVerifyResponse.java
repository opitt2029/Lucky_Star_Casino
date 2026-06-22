package com.luckystar.game.dto;

import lombok.Builder;
import lombok.Value;

/**
 * 捕魚機單發子彈公平性驗證回應（場次結算後可用）。
 *
 * <p>以場次紀錄的 (serverSeed, clientSeed) 與指定 shotSeq 重放該發判定，
 * 並驗證 serverSeed 與開場公布的承諾雜湊相符。
 */
@Value
@Builder
public class FishingShotVerifyResponse {

    String sessionId;
    long shotSeq;
    String fishType;
    long betPerShot;
    /** SHA-256(serverSeed) 是否等於開場公布的 serverSeedHash。 */
    boolean commitmentValid;
    /** RNG 判定原始命中結果（未套用風控規則）。 */
    boolean hit;
    /** RNG 判定原始派彩（未套用風控規則）。 */
    long payout;
    /** 此場次是否曾有批次被風控攔截；若為 true，命中局的實際入帳派彩為 0。 */
    boolean riskControlled;
    String serverSeed;
    String serverSeedHash;
    String clientSeed;
    String message;
}
