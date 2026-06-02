package com.luckystar.game.client.dto;

/**
 * 對 {@code POST /internal/wallet/credit} 的請求（派彩）。欄位對齊 wallet-service 的 CreditRequest。
 * 老虎機派彩 {@code subType} 固定為 {@code "WIN"}，不涉及解凍故 {@code unfreezeAmount} 傳 0。
 *
 * @param playerId       入帳玩家 ID
 * @param amount         派彩金額（星幣，正數）
 * @param subType        帳務子類型（派彩為 "WIN"）
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
