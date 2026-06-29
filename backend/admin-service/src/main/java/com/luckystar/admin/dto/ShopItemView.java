package com.luckystar.admin.dto;

import com.luckystar.admin.mysql.entity.ShopItem;
import java.time.LocalDateTime;

/** 後台商城商品檢視。 */
public record ShopItemView(
        Long id,
        String itemCode,
        String name,
        String caption,
        Long costStar,
        String assetKey,
        Integer sortOrder,
        boolean active,
        LocalDateTime createdAt,
        LocalDateTime updatedAt
) {
    public static ShopItemView from(ShopItem item) {
        return new ShopItemView(
                item.getId(),
                item.getItemCode(),
                item.getName(),
                item.getCaption(),
                item.getCostStar(),
                item.getAssetKey(),
                item.getSortOrder(),
                item.isActive(),
                item.getCreatedAt(),
                item.getUpdatedAt());
    }
}
