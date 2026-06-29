package com.luckystar.admin.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Size;

/** 新增商城商品請求（POST /admin/shop/items）。 */
public record ShopItemRequest(
        @NotBlank @Size(max = 50) String itemCode,
        @NotBlank @Size(max = 100) String name,
        @Size(max = 255) String caption,
        @NotNull @Positive Long costStar,
        @Size(max = 50) String assetKey,
        Integer sortOrder,
        Boolean active
) {}
