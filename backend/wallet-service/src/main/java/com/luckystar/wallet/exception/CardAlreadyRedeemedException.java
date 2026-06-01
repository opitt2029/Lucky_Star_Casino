package com.luckystar.wallet.exception;

/**
 * 點數卡已被兌換（T-102）。序號存在但 {@code is_redeemed=true}，或並發兌換時 CAS 落敗 → 422。
 *
 * <p>用 422（而非 409）：這是「不可重試」的業務狀態——同一序號永遠只能兌換一次，重送也不會成功，
 * 與 409「並發衝突請重試」（{@link org.springframework.orm.ObjectOptimisticLockingFailureException}）語意不同。
 */
public class CardAlreadyRedeemedException extends RuntimeException {
    public CardAlreadyRedeemedException(String message) {
        super(message);
    }
}
