package com.luckystar.wallet.exception;

public class ShopInventoryItemAlreadyUsedException extends RuntimeException {
    public ShopInventoryItemAlreadyUsedException(String message) {
        super(message);
    }
}