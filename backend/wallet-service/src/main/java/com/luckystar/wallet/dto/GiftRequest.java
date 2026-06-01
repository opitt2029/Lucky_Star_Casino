package com.luckystar.wallet.dto;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import lombok.Data;

/**
 * 好友星幣贈送請求（T-026）。對應 {@code POST /api/v1/wallet/gift}。
 *
 * <p>贈送方（sender）<b>不</b>在 body 內，由 gateway 注入的 {@code X-User-Id} header 決定，
 * 避免被冒名贈送他人的錢。body 只帶接收方、金額、冪等鍵。
 *
 * <p>贈送會在 PostgreSQL 一筆交易內做雙向帳務異動（sender 出帳 DEBIT/GIFT、receiver 入帳 CREDIT/GIFT），
 * 並受 Redis 當日「贈出 / 收受」上限限制（見 {@link com.luckystar.wallet.service.GiftService}）。
 */
@Data
public class GiftRequest {

    /** 接收方玩家 ID（不可與贈送方相同）。 */
    @NotNull
    private Long receiverId;

    /** 贈送金額（星幣），必須為正數（DB 也有 amount > 0 的 CHECK 約束）。 */
    @NotNull
    @Positive
    private Long amount;

    /**
     * 冪等鍵：同一個 key 只會真正贈送一次（兩筆衍生流水各帶 {@code key:gift:debit}／{@code key:gift:credit}
     * 後綴，DB 對 idempotency_key 有 UNIQUE 約束）。重送時直接回傳原結果，<b>不</b>再扣 Redis 當日額度。
     * 上限 80 字，預留空間給衍生後綴（{@code :gift:credit}）後仍在 DB 的 100 字內。
     */
    @NotBlank
    @Size(max = 80)
    private String idempotencyKey;
}
