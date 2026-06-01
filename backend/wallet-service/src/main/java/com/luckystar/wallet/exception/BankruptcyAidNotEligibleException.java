package com.luckystar.wallet.exception;

/**
 * 不符合破產補助領取資格（T-027）。對應 HTTP 422。
 * 由 {@link com.luckystar.wallet.service.BankruptcyAidService} 在下列情況拋出：
 * <ul>
 *   <li>餘額未低於門檻（不夠「破產」，無需補助）。</li>
 *   <li>當日已領過（Redis 當日狀態命中，或 DB 冪等已存在）。</li>
 * </ul>
 */
public class BankruptcyAidNotEligibleException extends RuntimeException {
    public BankruptcyAidNotEligibleException(String message) {
        super(message);
    }
}
