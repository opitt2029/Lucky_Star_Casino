package com.luckystar.wallet.dto;

import lombok.Builder;
import lombok.Data;

/**
 * 破產補助發放回應（T-027）。對應 {@code POST /api/v1/wallet/bankruptcy-aid}。
 *
 * <p>回傳本次補助入帳的流水 ID、發放金額與入帳前後餘額，方便前端即時更新顯示。
 */
@Data
@Builder
public class BankruptcyAidResponse {

    private Long playerId;

    /** 本次發放的補助金額（固定 {@code BankruptcyAidService.AID_AMOUNT}）。 */
    private Long amount;

    /** 補助入帳產生的流水紀錄 ID。 */
    private Long transactionId;

    /** 入帳前餘額。 */
    private Long balanceBefore;

    /** 入帳後餘額。 */
    private Long balanceAfter;
}
