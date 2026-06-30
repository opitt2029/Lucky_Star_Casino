package com.luckystar.game.dto;

import lombok.Builder;
import lombok.Value;

/** In-session fishing top-up response. */
@Value
@Builder
public class FishingTopUpResponse {
    String sessionId;
    long amount;
    long buyIn;
    long sessionBalance;
    WalletView wallet;
}
