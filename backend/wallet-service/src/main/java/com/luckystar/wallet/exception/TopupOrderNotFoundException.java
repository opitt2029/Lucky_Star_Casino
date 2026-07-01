package com.luckystar.wallet.exception;

/** 查無指定加值訂單（或不屬於該玩家）→ 404。 */
public class TopupOrderNotFoundException extends RuntimeException {
    public TopupOrderNotFoundException(String message) {
        super(message);
    }
}
