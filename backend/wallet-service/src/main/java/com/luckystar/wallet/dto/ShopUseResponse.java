package com.luckystar.wallet.dto;

import com.luckystar.wallet.postgres.entity.ShopRedemption;
import lombok.Builder;
import lombok.Data;

import java.time.LocalDateTime;

@Data
@Builder
public class ShopUseResponse {

    private Long id;
    private String itemCode;
    private String itemName;
    private String status;
    private String action;
    private LocalDateTime usedAt;
    private LocalDateTime equippedAt;

    public static ShopUseResponse from(ShopRedemption redemption, String action) {
        return ShopUseResponse.builder()
                .id(redemption.getId())
                .itemCode(redemption.getItemCode())
                .itemName(redemption.getItemName())
                .status(redemption.getStatus())
                .action(action)
                .usedAt(redemption.getUsedAt())
                .equippedAt(redemption.getEquippedAt())
                .build();
    }
}