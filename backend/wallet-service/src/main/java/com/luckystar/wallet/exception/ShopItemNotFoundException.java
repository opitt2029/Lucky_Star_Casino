package com.luckystar.wallet.exception;

/** 商城商品代號不存在 → 404。 */
public class ShopItemNotFoundException extends RuntimeException {

    public ShopItemNotFoundException(String message) {
        super(message);
    }
}
