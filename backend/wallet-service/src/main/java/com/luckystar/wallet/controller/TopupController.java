package com.luckystar.wallet.controller;

import com.luckystar.wallet.common.ApiResponse;
import com.luckystar.wallet.dto.CreateTopupOrderRequest;
import com.luckystar.wallet.dto.TopupOrderResponse;
import com.luckystar.wallet.dto.TopupPackageResponse;
import com.luckystar.wallet.service.TopupService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/**
 * 玩家自助加值（模擬支付，無真實金流）。
 *
 * <p>方案列表 → 建單 → 模擬付款（真實入帳）→ 訂單記錄。玩家身分一律由 gateway 注入的
 * {@code X-User-Id} header 決定，只能操作自己的訂單。
 */
@RestController
@RequestMapping("/api/v1/wallet/topup")
@Tag(name = "自助加值", description = "加值方案、建單、模擬付款、訂單記錄")
public class TopupController {

    private final TopupService topupService;

    public TopupController(TopupService topupService) {
        this.topupService = topupService;
    }

    @Operation(summary = "取得可選加值方案")
    @GetMapping("/packages")
    public ResponseEntity<ApiResponse<List<TopupPackageResponse>>> packages() {
        return ResponseEntity.ok(ApiResponse.ok(topupService.getPackages()));
    }

    @Operation(summary = "建立加值訂單（status=CREATED）")
    @PostMapping("/orders")
    public ResponseEntity<ApiResponse<TopupOrderResponse>> createOrder(
            @RequestHeader(value = "X-User-Id", required = false) String playerIdStr,
            @Valid @RequestBody CreateTopupOrderRequest request) {

        Long playerId = parsePlayerId(playerIdStr);
        TopupOrderResponse response = topupService.createOrder(playerId, request.getPackageId());
        return ResponseEntity.status(HttpStatus.CREATED).body(ApiResponse.ok(response));
    }

    @Operation(summary = "模擬付款（成功後真實入帳星幣）")
    @PostMapping("/orders/{id}/pay")
    public ResponseEntity<ApiResponse<TopupOrderResponse>> pay(
            @RequestHeader(value = "X-User-Id", required = false) String playerIdStr,
            @PathVariable Long id) {

        Long playerId = parsePlayerId(playerIdStr);
        TopupOrderResponse response = topupService.pay(playerId, id);
        return ResponseEntity.ok(ApiResponse.ok(response));
    }

    @Operation(summary = "查詢自己的加值訂單（新到舊）")
    @GetMapping("/orders")
    public ResponseEntity<ApiResponse<List<TopupOrderResponse>>> orders(
            @RequestHeader(value = "X-User-Id", required = false) String playerIdStr) {

        Long playerId = parsePlayerId(playerIdStr);
        return ResponseEntity.ok(ApiResponse.ok(topupService.listOrders(playerId)));
    }

    /** 解析 gateway 注入的 X-User-Id，缺漏或非數字一律以 IllegalArgumentException → 由下方 400 處理。 */
    private Long parsePlayerId(String playerIdStr) {
        if (playerIdStr == null || playerIdStr.isBlank()) {
            throw new IllegalArgumentException("Missing X-User-Id header");
        }
        try {
            return Long.parseLong(playerIdStr);
        } catch (NumberFormatException e) {
            throw new IllegalArgumentException("Invalid X-User-Id header");
        }
    }
}
