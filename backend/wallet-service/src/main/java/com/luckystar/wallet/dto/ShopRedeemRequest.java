package com.luckystar.wallet.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import lombok.Data;

/**
 * 商城兌換請求。對應 {@code POST /api/v1/wallet/shop/redeem}。
 *
 * <p>兌換者（playerId）<b>不</b>在 body，由 gateway 注入的 {@code X-User-Id} header 決定。
 * body 帶商品代號與選填的 client 冪等鍵（同一鍵重送不重複扣款；不帶則由伺服器以
 * playerId+itemCode+時間粒度組鍵）。
 */
@Data
public class ShopRedeemRequest {

    /** 商品代號，對應 shop_items.item_code。 */
    @NotBlank
    @Size(max = 50)
    private String itemCode;

    /** 選填冪等鍵（client 端產生；重試時複用同一鍵避免重複兌換）。 */
    @Size(max = 80)
    private String idempotencyKey;
}
