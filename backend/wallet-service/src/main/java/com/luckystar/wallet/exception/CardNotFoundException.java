package com.luckystar.wallet.exception;

/**
 * 點數卡序號不存在（T-102）。玩家輸入的 {@code card_code} 在 {@code diamond_cards} 查無此卡 → 404。
 */
public class CardNotFoundException extends RuntimeException {
    public CardNotFoundException(String message) {
        super(message);
    }
}
