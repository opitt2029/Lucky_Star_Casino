package com.luckystar.game.client.dto;

/**
 * 對 {@code POST /internal/wallet/credit} 的請求（派彩）。欄位對齊 wallet-service 的 CreditRequest。
 * 老虎機 / 百家樂中獎派彩 {@code subType} 為 {@code "WIN"}；捕魚退款／本金返還用 {@code "REFUND"}
 * （避免被 rank 計入贏幣榜）。本流程不涉及解凍故 {@code unfreezeAmount} 傳 0。
 *
 * @param playerId       入帳玩家 ID
 * @param amount         派彩金額（星幣，正數）
 * @param subType        帳務子類型（中獎派彩為 "WIN"、退款／本金返還為 "REFUND"）
 * @param idempotencyKey 冪等鍵
 * @param referenceId    關聯 ID（roundId）
 * @param unfreezeAmount 解凍金額（老虎機為 0）
 */
public record WalletCreditRequest(
        Long playerId,
        Long amount,
        String subType,
        String idempotencyKey,
        String referenceId,
        Long unfreezeAmount) {
}
