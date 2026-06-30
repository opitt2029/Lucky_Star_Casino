package com.luckystar.admin.dto;

import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Size;

/**
 * 更新商城商品請求（PUT /admin/shop/items/{id}）。
 * 各欄位皆選填，{@code null} 表示不變動（部分更新；常用於改價、上下架）。
 */
public record ShopItemUpdateRequest(
        @Size(max = 100) String name,
        @Size(max = 255) String caption,
        @Positive Long costStar,
        @Size(max = 50) String assetKey,
        Integer sortOrder,
        Boolean active
) {}
