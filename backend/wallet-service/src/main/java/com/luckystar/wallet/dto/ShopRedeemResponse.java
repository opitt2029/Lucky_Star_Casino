package com.luckystar.wallet.dto;

import lombok.Builder;
import lombok.Data;

/**
 * 商城兌換回應。回傳兌換的商品與兌換後星幣餘額。
 */
@Data
@Builder
public class ShopRedeemResponse {

    private String itemCode;
    private String itemName;
    private Long starSpent;
    private Long balanceAfter;
    /** 冪等命中（同一鍵已兌換過，未再次扣款）為 true。 */
    private boolean idempotent;
}
