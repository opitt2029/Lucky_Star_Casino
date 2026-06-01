package com.luckystar.wallet.controller;

import com.luckystar.wallet.common.ApiResponse;
import com.luckystar.wallet.common.PagedResponse;
import com.luckystar.wallet.dto.BankruptcyAidResponse;
import com.luckystar.wallet.dto.GiftRequest;
import com.luckystar.wallet.dto.GiftResponse;
import com.luckystar.wallet.dto.WalletBalanceResponse;
import com.luckystar.wallet.dto.WalletTransactionResponse;
import com.luckystar.wallet.service.BankruptcyAidService;
import com.luckystar.wallet.service.GiftService;
import com.luckystar.wallet.service.WalletQueryService;
import com.luckystar.wallet.service.WalletService;
import jakarta.validation.Valid;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.Set;

@RestController
@RequestMapping("/api/v1/wallet")
public class WalletController {

    /** T-025 允許過濾的交易類型（對齊讀庫 chk_wt_type 約束）。 */
    private static final Set<String> ALLOWED_TYPES = Set.of("DEBIT", "CREDIT", "BONUS");

    /** 每頁筆數上限，避免單次查詢拖垮讀庫。 */
    private static final int MAX_PAGE_SIZE = 100;

    private final WalletService walletService;
    private final WalletQueryService walletQueryService;
    private final GiftService giftService;
    private final BankruptcyAidService bankruptcyAidService;

    public WalletController(WalletService walletService, WalletQueryService walletQueryService,
                           GiftService giftService, BankruptcyAidService bankruptcyAidService) {
        this.walletService = walletService;
        this.walletQueryService = walletQueryService;
        this.giftService = giftService;
        this.bankruptcyAidService = bankruptcyAidService;
    }

    @GetMapping("/balance")
    public ResponseEntity<ApiResponse<WalletBalanceResponse>> getBalance(
            @RequestHeader(value = "X-User-Id", required = false) String playerIdStr) {

        if (playerIdStr == null || playerIdStr.isBlank()) {
            return ResponseEntity.badRequest()
                    .body(ApiResponse.error("Missing X-User-Id header"));
        }

        Long playerId;
        try {
            playerId = Long.parseLong(playerIdStr);
        } catch (NumberFormatException e) {
            return ResponseEntity.badRequest()
                    .body(ApiResponse.error("Invalid X-User-Id header"));
        }

        WalletBalanceResponse response = walletService.getBalance(playerId);
        return ResponseEntity.ok(ApiResponse.ok(response));
    }

    /**
     * 帳務流水查詢（T-025）。走 MySQL 讀庫（CQRS 讀端，ADR-001）。
     *
     * <p>支援分頁（page/size）、類型過濾（DEBIT/CREDIT/BONUS）、日期區間（from/to，含當日）。
     * 玩家身分由 gateway 注入的 {@code X-User-Id} header 決定，僅能查自己的流水。
     *
     * @param page 頁碼（0-based，預設 0）
     * @param size 每頁筆數（預設 20，上限 {@value #MAX_PAGE_SIZE}）
     * @param type 交易類型，限 DEBIT/CREDIT/BONUS；省略則不過濾
     * @param from 起始日（含），ISO 格式 yyyy-MM-dd；以該日 00:00 起算
     * @param to   結束日（含），ISO 格式 yyyy-MM-dd；涵蓋整個該日
     */
    @GetMapping("/transactions")
    public ResponseEntity<ApiResponse<PagedResponse<WalletTransactionResponse>>> getTransactions(
            @RequestHeader(value = "X-User-Id", required = false) String playerIdStr,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size,
            @RequestParam(required = false) String type,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to) {

        if (playerIdStr == null || playerIdStr.isBlank()) {
            return ResponseEntity.badRequest()
                    .body(ApiResponse.error("Missing X-User-Id header"));
        }

        Long playerId;
        try {
            playerId = Long.parseLong(playerIdStr);
        } catch (NumberFormatException e) {
            return ResponseEntity.badRequest()
                    .body(ApiResponse.error("Invalid X-User-Id header"));
        }

        if (page < 0) {
            return ResponseEntity.badRequest()
                    .body(ApiResponse.error("page must be >= 0"));
        }
        if (size < 1 || size > MAX_PAGE_SIZE) {
            return ResponseEntity.badRequest()
                    .body(ApiResponse.error("size must be between 1 and " + MAX_PAGE_SIZE));
        }

        String normalizedType = null;
        if (type != null && !type.isBlank()) {
            normalizedType = type.trim().toUpperCase();
            if (!ALLOWED_TYPES.contains(normalizedType)) {
                return ResponseEntity.badRequest()
                        .body(ApiResponse.error("type must be one of DEBIT, CREDIT, BONUS"));
            }
        }

        if (from != null && to != null && from.isAfter(to)) {
            return ResponseEntity.badRequest()
                    .body(ApiResponse.error("from must not be after to"));
        }

        // from 從當日 00:00 起算（含）；to 以隔日 00:00 為上界（不含），藉此涵蓋整個 to 當日。
        LocalDateTime fromDateTime = from == null ? null : from.atStartOfDay();
        LocalDateTime toDateTime = to == null ? null : to.plusDays(1).atStartOfDay();

        PagedResponse<WalletTransactionResponse> response =
                walletQueryService.getTransactions(playerId, normalizedType, fromDateTime, toDateTime, page, size);
        return ResponseEntity.ok(ApiResponse.ok(response));
    }

    /**
     * 好友星幣贈送（T-026）。贈送方由 gateway 注入的 {@code X-User-Id} header 決定（不可由 body 指定，
     * 避免冒名贈送他人的錢）；接收方、金額、冪等鍵走 body。
     *
     * <p>受 Redis 當日額度限制（贈出 5,000 / 收受 10,000，TTL 到午夜），在 PostgreSQL 一筆交易內
     * 做雙向帳務異動並寫 gift_logs，邏輯見 {@link GiftService#gift}。
     *
     * <p>錯誤對應：贈送給自己 → 400；當日超額 → 422；餘額不足 → 422；錢包不存在 → 404；
     * 並發樂觀鎖衝突 → 409（皆由 GlobalExceptionHandler 統一處理）。
     */
    @PostMapping("/gift")
    public ResponseEntity<ApiResponse<GiftResponse>> gift(
            @RequestHeader(value = "X-User-Id", required = false) String playerIdStr,
            @Valid @RequestBody GiftRequest request) {

        if (playerIdStr == null || playerIdStr.isBlank()) {
            return ResponseEntity.badRequest()
                    .body(ApiResponse.error("Missing X-User-Id header"));
        }

        Long senderId;
        try {
            senderId = Long.parseLong(playerIdStr);
        } catch (NumberFormatException e) {
            return ResponseEntity.badRequest()
                    .body(ApiResponse.error("Invalid X-User-Id header"));
        }

        GiftResponse response = giftService.gift(senderId, request);
        return ResponseEntity.ok(ApiResponse.ok(response));
    }

    /**
     * 破產補助領取（T-027）。對應 {@code POST /api/v1/wallet/bankruptcy-aid}。
     *
     * <p>玩家身分由 gateway 注入的 {@code X-User-Id} header 決定（只能領自己的）。無 request body。
     * 餘額低於門檻且當日未領過時，發放固定金額補助；當日狀態記在 Redis、TTL 到午夜，邏輯見
     * {@link BankruptcyAidService#claim}。
     *
     * <p>錯誤對應：餘額未達門檻 / 當日已領過 → 422；錢包不存在 → 404；
     * 並發樂觀鎖衝突 → 409（皆由 GlobalExceptionHandler 統一處理）。
     */
    @PostMapping("/bankruptcy-aid")
    public ResponseEntity<ApiResponse<BankruptcyAidResponse>> bankruptcyAid(
            @RequestHeader(value = "X-User-Id", required = false) String playerIdStr) {

        if (playerIdStr == null || playerIdStr.isBlank()) {
            return ResponseEntity.badRequest()
                    .body(ApiResponse.error("Missing X-User-Id header"));
        }

        Long playerId;
        try {
            playerId = Long.parseLong(playerIdStr);
        } catch (NumberFormatException e) {
            return ResponseEntity.badRequest()
                    .body(ApiResponse.error("Invalid X-User-Id header"));
        }

        BankruptcyAidResponse response = bankruptcyAidService.claim(playerId);
        return ResponseEntity.ok(ApiResponse.ok(response));
    }
}
