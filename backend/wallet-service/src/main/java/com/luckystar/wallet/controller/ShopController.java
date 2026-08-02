package com.luckystar.wallet.controller;

import com.luckystar.wallet.common.ApiResponse;
import com.luckystar.wallet.dto.ShopInventoryItem;
import com.luckystar.wallet.dto.ShopItemView;
import com.luckystar.wallet.dto.ShopRedeemRequest;
import com.luckystar.wallet.dto.ShopRedeemResponse;
import com.luckystar.wallet.dto.ShopUseResponse;
import com.luckystar.wallet.service.ShopRedemptionService;
import jakarta.validation.Valid;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequestMapping("/api/v1/wallet/shop")
public class ShopController {

    private final ShopRedemptionService shopRedemptionService;

    public ShopController(ShopRedemptionService shopRedemptionService) {
        this.shopRedemptionService = shopRedemptionService;
    }

    @GetMapping("/catalog")
    public ResponseEntity<ApiResponse<List<ShopItemView>>> catalog() {
        return ResponseEntity.ok(ApiResponse.ok(shopRedemptionService.getCatalog()));
    }

    @PostMapping("/redeem")
    public ResponseEntity<ApiResponse<ShopRedeemResponse>> redeem(
            @RequestHeader(value = "X-User-Id", required = false) String playerIdStr,
            @Valid @RequestBody ShopRedeemRequest request) {
        Long playerId = parsePlayerId(playerIdStr);
        ShopRedeemResponse response =
                shopRedemptionService.redeem(playerId, request.getItemCode(), request.getIdempotencyKey());
        return ResponseEntity.ok(ApiResponse.ok(response));
    }

    @GetMapping("/inventory")
    public ResponseEntity<ApiResponse<List<ShopInventoryItem>>> inventory(
            @RequestHeader(value = "X-User-Id", required = false) String playerIdStr) {
        Long playerId = parsePlayerId(playerIdStr);
        return ResponseEntity.ok(ApiResponse.ok(shopRedemptionService.getInventory(playerId)));
    }

    @PostMapping("/inventory/{id}/use")
    public ResponseEntity<ApiResponse<ShopUseResponse>> useInventoryItem(
            @RequestHeader(value = "X-User-Id", required = false) String playerIdStr,
            @PathVariable("id") Long inventoryItemId) {
        Long playerId = parsePlayerId(playerIdStr);
        return ResponseEntity.ok(ApiResponse.ok(shopRedemptionService.useInventoryItem(playerId, inventoryItemId)));
    }

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
