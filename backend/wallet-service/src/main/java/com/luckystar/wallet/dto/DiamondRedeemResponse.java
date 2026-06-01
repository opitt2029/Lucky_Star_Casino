package com.luckystar.wallet.dto;

import lombok.Builder;
import lombok.Data;

/**
 * 點數卡兌換鑽石回應（T-102）。回傳本次兌換到的鑽石數與兌換後的鑽石餘額。
 *
 * @see DiamondRedeemRequest
 */
@Data
@Builder
public class DiamondRedeemResponse {

    private Long playerId;

    /** 本次兌換的點數卡序號。 */
    private String cardCode;

    /** 本次兌換到的鑽石數（= 點數卡面額）。 */
    private Long redeemedDiamonds;

    /** 兌換後的鑽石總餘額。 */
    private Long diamondBalance;
}
