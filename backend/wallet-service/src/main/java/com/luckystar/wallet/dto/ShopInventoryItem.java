package com.luckystar.wallet.dto;

import com.luckystar.wallet.postgres.entity.ShopRedemption;
import lombok.Builder;
import lombok.Data;

import java.time.LocalDateTime;

/** Player inventory item returned from shop redemptions. */
@Data
@Builder
public class ShopInventoryItem {

    private Long id;
    private String itemCode;
    private String title;
    private Long cost;
    private String status;
    private LocalDateTime redeemedAt;
    private LocalDateTime usedAt;
    private LocalDateTime equippedAt;

    public static ShopInventoryItem from(ShopRedemption r) {
        return ShopInventoryItem.builder()
                .id(r.getId())
                .itemCode(r.getItemCode())
                .title(r.getItemName())
                .cost(r.getStarSpent())
                .status(r.getStatus())
                .redeemedAt(r.getCreatedAt())
                .usedAt(r.getUsedAt())
                .equippedAt(r.getEquippedAt())
                .build();
    }
}