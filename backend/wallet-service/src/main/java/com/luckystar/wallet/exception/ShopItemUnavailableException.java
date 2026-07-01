package com.luckystar.wallet.exception;

/** 商城商品已下架，不可兌換 → 422。 */
public class ShopItemUnavailableException extends RuntimeException {

    public ShopItemUnavailableException(String message) {
        super(message);
    }
}
