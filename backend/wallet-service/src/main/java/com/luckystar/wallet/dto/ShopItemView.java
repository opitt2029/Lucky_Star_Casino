package com.luckystar.wallet.dto;

import com.luckystar.wallet.mysql.entity.ShopItem;
import lombok.Builder;
import lombok.Data;

/**
 * 商城目錄項目（玩家端列目錄用）。
 */
@Data
@Builder
public class ShopItemView {

    private String itemCode;
    private String name;
    private String caption;
    private Long cost;
    private String assetKey;

    public static ShopItemView from(ShopItem item) {
        return ShopItemView.builder()
                .itemCode(item.getItemCode())
                .name(item.getName())
                .caption(item.getCaption())
                .cost(item.getCostStar())
                .assetKey(item.getAssetKey())
                .build();
    }
}
