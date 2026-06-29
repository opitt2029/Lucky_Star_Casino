package com.luckystar.wallet.controller;

import com.luckystar.wallet.common.ApiResponse;
import com.luckystar.wallet.dto.ShopInventoryItem;
import com.luckystar.wallet.dto.ShopItemView;
import com.luckystar.wallet.dto.ShopRedeemRequest;
import com.luckystar.wallet.dto.ShopRedeemResponse;
import com.luckystar.wallet.service.ShopRedemptionService;
import jakarta.validation.Valid;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/**
 * 禮品商城 API（ADR-006）。掛在 {@code /api/v1/wallet/shop}，被 gateway 既有 wallet 路由吃下
 * （與 {@link DiamondController} 同理，免改 gateway）。玩家身分由 gateway 注入的 {@code X-User-Id} 決定。
 */
@RestController
@RequestMapping("/api/v1/wallet/shop")
public class ShopController {

    private final ShopRedemptionService shopRedemptionService;

    public ShopController(ShopRedemptionService shopRedemptionService) {
        this.shopRedemptionService = shopRedemptionService;
    }

    /** 目錄：上架商品清單。 */
    @GetMapping("/catalog")
    public ResponseEntity<ApiResponse<List<ShopItemView>>> catalog() {
        return ResponseEntity.ok(ApiResponse.ok(shopRedemptionService.getCatalog()));
    }

    /**
     * 兌換禮品：以星幣扣款並寫兌換紀錄（原子）。
     *
     * <p>錯誤對應：商品不存在 → 404；商品下架 → 422；星幣不足 → 422；錢包不存在 → 404；
     * 並發樂觀鎖衝突 → 409（皆由 {@link com.luckystar.wallet.exception.GlobalExceptionHandler} 統一處理）。
     */
    @PostMapping("/redeem")
    public ResponseEntity<ApiResponse<ShopRedeemResponse>> redeem(
            @RequestHeader(value = "X-User-Id", required = false) String playerIdStr,
            @Valid @RequestBody ShopRedeemRequest request) {
        Long playerId = parsePlayerId(playerIdStr);
        ShopRedeemResponse response =
                shopRedemptionService.redeem(playerId, request.getItemCode(), request.getIdempotencyKey());
        return ResponseEntity.ok(ApiResponse.ok(response));
    }

    /** 背包：玩家兌換到的禮品（新到舊）。 */
    @GetMapping("/inventory")
    public ResponseEntity<ApiResponse<List<ShopInventoryItem>>> inventory(
            @RequestHeader(value = "X-User-Id", required = false) String playerIdStr) {
        Long playerId = parsePlayerId(playerIdStr);
        return ResponseEntity.ok(ApiResponse.ok(shopRedemptionService.getInventory(playerId)));
    }

    /** 解析 gateway 注入的 X-User-Id；缺漏/非法丟 IllegalArgumentException → 400。 */
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
