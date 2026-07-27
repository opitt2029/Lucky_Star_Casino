package com.luckystar.game.exception;

/**
 * Session 樂觀鎖（Redis Lua CAS，ADR-008）重試次數用盡：期間有其他請求持續搶先寫入同一 session。
 * 未落地任何一半的異動（每次重試都是「重讀→重放→CAS」整包失敗或成功，不會產生中間態）。
 */
public class SessionConflictException extends RuntimeException {
    public SessionConflictException(String message) {
        super(message);
    }
}
