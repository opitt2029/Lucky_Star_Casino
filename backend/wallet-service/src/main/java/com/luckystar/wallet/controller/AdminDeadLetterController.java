package com.luckystar.wallet.controller;

import com.luckystar.wallet.common.ApiResponse;
import com.luckystar.wallet.common.PagedResponse;
import com.luckystar.wallet.dto.DeadLetterMessageResponse;
import com.luckystar.wallet.dto.DeadLetterRetryResponse;
import com.luckystar.wallet.service.DeadLetterService;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * Admin DLT 查詢 / 手動重試 API（T-028）。
 *
 * <p>掛在 {@code /internal/wallet/dlt}，沿用既有 {@code InternalSecretFilter}（X-Internal-Secret），
 * 由 admin-service 經內部密鑰呼叫，不對外開放（與 {@link InternalWalletController} 一致）。
 */
@RestController
@RequestMapping("/internal/wallet/dlt")
@RequiredArgsConstructor
public class AdminDeadLetterController {

    /** 每頁筆數上限，避免單次查詢回傳過多 payload。 */
    private static final int MAX_PAGE_SIZE = 100;

    private final DeadLetterService deadLetterService;

    /**
     * 查詢 DLT 失敗訊息，支援狀態（FAILED/RETRIED/RESOLVED）與 DLT topic 過濾，分頁回傳。
     *
     * @param status   狀態過濾，省略則不限
     * @param dltTopic DLT topic 過濾（如 wallet.credit.DLT），省略則不限
     * @param page     頁碼（0-based，預設 0）
     * @param size     每頁筆數（預設 20，上限 {@value #MAX_PAGE_SIZE}）
     */
    @GetMapping
    public ResponseEntity<ApiResponse<PagedResponse<DeadLetterMessageResponse>>> query(
            @RequestParam(required = false) String status,
            @RequestParam(required = false) String dltTopic,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size) {

        int safeSize = Math.min(Math.max(size, 1), MAX_PAGE_SIZE);
        int safePage = Math.max(page, 0);
        Pageable pageable = PageRequest.of(safePage, safeSize,
                Sort.by(Sort.Direction.DESC, "createdAt"));

        PagedResponse<DeadLetterMessageResponse> result =
                deadLetterService.query(status, dltTopic, pageable);
        return ResponseEntity.ok(ApiResponse.ok(result));
    }

    /**
     * 手動重試指定 DLT 訊息：把原始 payload 重發回原 topic，標記為 RETRIED。
     *
     * @param id DLT 訊息紀錄 ID
     */
    @PostMapping("/{id}/retry")
    public ResponseEntity<ApiResponse<DeadLetterRetryResponse>> retry(@PathVariable Long id) {
        DeadLetterRetryResponse response = deadLetterService.retry(id);
        return ResponseEntity.ok(ApiResponse.ok(response));
    }
}
