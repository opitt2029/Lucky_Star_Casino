package com.luckystar.wallet.exception;

import com.luckystar.wallet.common.ApiResponse;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.orm.ObjectOptimisticLockingFailureException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;

@Slf4j
@RestControllerAdvice
public class GlobalExceptionHandler {

    @ExceptionHandler(WalletNotFoundException.class)
    @ResponseStatus(HttpStatus.NOT_FOUND)
    public ApiResponse<Void> handleWalletNotFound(WalletNotFoundException ex) {
        return ApiResponse.error(ex.getMessage());
    }

    @ExceptionHandler(InsufficientBalanceException.class)
    @ResponseStatus(HttpStatus.UNPROCESSABLE_ENTITY)
    public ApiResponse<Void> handleInsufficientBalance(InsufficientBalanceException ex) {
        return ApiResponse.error(ex.getMessage());
    }

    /** 贈送超過當日上限（T-026）→ 422。 */
    @ExceptionHandler(GiftLimitExceededException.class)
    @ResponseStatus(HttpStatus.UNPROCESSABLE_ENTITY)
    public ApiResponse<Void> handleGiftLimitExceeded(GiftLimitExceededException ex) {
        return ApiResponse.error(ex.getMessage());
    }

    /** 不合法的贈送請求，例如贈送給自己（T-026）→ 400。 */
    @ExceptionHandler(InvalidGiftException.class)
    @ResponseStatus(HttpStatus.BAD_REQUEST)
    public ApiResponse<Void> handleInvalidGift(InvalidGiftException ex) {
        return ApiResponse.error(ex.getMessage());
    }

    /** 不符破產補助資格：餘額未達門檻或當日已領過（T-027）→ 422。 */
    @ExceptionHandler(BankruptcyAidNotEligibleException.class)
    @ResponseStatus(HttpStatus.UNPROCESSABLE_ENTITY)
    public ApiResponse<Void> handleBankruptcyAidNotEligible(BankruptcyAidNotEligibleException ex) {
        return ApiResponse.error(ex.getMessage());
    }

    /** 點數卡序號不存在（T-102）→ 404。 */
    @ExceptionHandler(CardNotFoundException.class)
    @ResponseStatus(HttpStatus.NOT_FOUND)
    public ApiResponse<Void> handleCardNotFound(CardNotFoundException ex) {
        return ApiResponse.error(ex.getMessage());
    }

    /** 鑽石錢包不存在（T-102）→ 404。 */
    @ExceptionHandler(DiamondWalletNotFoundException.class)
    @ResponseStatus(HttpStatus.NOT_FOUND)
    public ApiResponse<Void> handleDiamondWalletNotFound(DiamondWalletNotFoundException ex) {
        return ApiResponse.error(ex.getMessage());
    }

    /** 點數卡已兌換，或並發重複兌換時 CAS 落敗（T-102）→ 422（不可重試的業務狀態）。 */
    @ExceptionHandler(CardAlreadyRedeemedException.class)
    @ResponseStatus(HttpStatus.UNPROCESSABLE_ENTITY)
    public ApiResponse<Void> handleCardAlreadyRedeemed(CardAlreadyRedeemedException ex) {
        return ApiResponse.error(ex.getMessage());
    }

    /** 查無指定的 DLT 失敗訊息（T-028）→ 404。 */
    @ExceptionHandler(DeadLetterNotFoundException.class)
    @ResponseStatus(HttpStatus.NOT_FOUND)
    public ApiResponse<Void> handleDeadLetterNotFound(DeadLetterNotFoundException ex) {
        return ApiResponse.error(ex.getMessage());
    }

    /** 對已解決的 DLT 訊息重試等不合法狀態操作（T-028）→ 409。 */
    @ExceptionHandler(IllegalDltStateException.class)
    @ResponseStatus(HttpStatus.CONFLICT)
    public ApiResponse<Void> handleIllegalDltState(IllegalDltStateException ex) {
        return ApiResponse.error(ex.getMessage());
    }

    @ExceptionHandler(ObjectOptimisticLockingFailureException.class)
    @ResponseStatus(HttpStatus.CONFLICT)
    public ApiResponse<Void> handleOptimisticLock(ObjectOptimisticLockingFailureException ex) {
        log.warn("Optimistic lock conflict: {}", ex.getMessage());
        return ApiResponse.error("Concurrent modification detected, please retry");
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    @ResponseStatus(HttpStatus.BAD_REQUEST)
    public ApiResponse<Void> handleValidation(MethodArgumentNotValidException ex) {
        String message = ex.getBindingResult().getFieldErrors().stream()
                .findFirst()
                .map(fe -> "Invalid request: " + fe.getField() + " " + fe.getDefaultMessage())
                .orElse("Invalid request");
        return ApiResponse.error(message);
    }

    /**
     * 查詢參數型別不符（例如 from/to 非 yyyy-MM-dd、page/size 非數字）→ 400。
     * 例：T-025 的 GET /transactions 帶了格式錯誤的日期。
     */
    @ExceptionHandler(MethodArgumentTypeMismatchException.class)
    @ResponseStatus(HttpStatus.BAD_REQUEST)
    public ApiResponse<Void> handleTypeMismatch(MethodArgumentTypeMismatchException ex) {
        return ApiResponse.error("Invalid value for parameter '" + ex.getName() + "'");
    }

    @ExceptionHandler(Exception.class)
    @ResponseStatus(HttpStatus.INTERNAL_SERVER_ERROR)
    public ApiResponse<Void> handleGeneral(Exception ex) {
        log.error("Unhandled exception", ex);
        return ApiResponse.error("Internal server error");
    }
}
