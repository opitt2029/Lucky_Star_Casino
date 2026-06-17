package com.luckystar.wallet.dto;

import com.luckystar.wallet.postgres.entity.TopupOrder;

import java.time.LocalDateTime;

/** 加值訂單回應（建單 / 付款 / 訂單列表共用）。 */
public record TopupOrderResponse(
        Long id,
        String orderNo,
        String packageId,
        long amount,
        String priceLabel,
        String status,
        Long creditTxId,
        Long balanceAfter,
        LocalDateTime createdAt,
        LocalDateTime paidAt) {

    /** 由 entity 轉換；balanceAfter 僅在付款入帳時帶入，其餘情境為 null。 */
    public static TopupOrderResponse from(TopupOrder o, Long balanceAfter) {
        return new TopupOrderResponse(
                o.getId(), o.getOrderNo(), o.getPackageId(), o.getAmount(),
                o.getPriceLabel(), o.getStatus(), o.getCreditTxId(),
                balanceAfter, o.getCreatedAt(), o.getPaidAt());
    }

    public static TopupOrderResponse from(TopupOrder o) {
        return from(o, null);
    }
}
