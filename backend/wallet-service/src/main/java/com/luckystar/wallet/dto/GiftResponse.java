package com.luckystar.wallet.dto;

import lombok.Builder;
import lombok.Data;

/**
 * 好友星幣贈送回應（T-026）。回傳雙向帳務異動的兩筆流水 ID 與雙方異動後餘額。
 *
 * @see GiftRequest
 */
@Data
@Builder
public class GiftResponse {

    private Long senderId;

    private Long receiverId;

    /** 本次贈送金額。 */
    private Long amount;

    /** 贈送方（出帳）流水 ID。 */
    private Long debitTransactionId;

    /** 接收方（入帳）流水 ID。 */
    private Long creditTransactionId;

    /** 贈送方異動後餘額。 */
    private Long senderBalanceAfter;

    /** 接收方異動後餘額。 */
    private Long receiverBalanceAfter;

    /**
     * 是否為冪等命中：true 代表這個 idempotencyKey 先前已贈送過，
     * 本次「沒有」重複轉帳，回傳的是當初那筆的結果。
     */
    private boolean idempotent;
}
