package com.luckystar.wallet.dto;

import com.luckystar.wallet.postgres.entity.ShopRedemption;
import lombok.Builder;
import lombok.Data;

import java.time.LocalDateTime;

/**
 * 玩家背包/兌換履歷項目（玩家端列背包用）。
 */
@Data
@Builder
public class ShopInventoryItem {

    private String itemCode;
    private String title;
    private Long cost;
    private LocalDateTime redeemedAt;

    public static ShopInventoryItem from(ShopRedemption r) {
        return ShopInventoryItem.builder()
                .itemCode(r.getItemCode())
                .title(r.getItemName())
                .cost(r.getStarSpent())
                .redeemedAt(r.getCreatedAt())
                .build();
    }
}
