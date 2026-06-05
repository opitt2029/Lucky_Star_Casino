package com.luckystar.game.client.dto;

/**
 * 對 {@code POST /internal/wallet/debit} 的請求。欄位對齊 wallet-service 的 DebitRequest。
 *
 * @param playerId       扣款玩家 ID
 * @param amount         扣款金額（星幣，正數）
 * @param idempotencyKey 冪等鍵（同 key 只會扣一次）
 * @param referenceId    關聯 ID（此處為 roundId，便於對帳）
 */
public record WalletDebitRequest(
        Long playerId,
        Long amount,
        String idempotencyKey,
        String referenceId) {
}
