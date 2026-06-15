package com.luckystar.game.dto;

import lombok.Builder;
import lombok.Value;

/**
 * 捕魚機結算回應：剩餘局內餘額已冪等 credit 回 wallet，並揭露 serverSeed（Provably Fair）。
 */
@Value
@Builder
public class FishingEndResponse {

    String sessionId;
    long buyIn;
    long totalBet;
    long totalPayout;
    long totalShots;
    /** 實際結算回錢包的金額（= 剩餘局內餘額）。 */
    long credited;
    /** 結算時揭露的 server seed，可逐發以 (serverSeed, clientSeed, shotSeq) 重放驗證。 */
    String serverSeed;
    String serverSeedHash;
    String clientSeed;
    WalletView wallet;
}
