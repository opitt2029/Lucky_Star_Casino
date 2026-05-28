package com.luckystar.wallet.controller;

import com.luckystar.wallet.common.ApiResponse;
import com.luckystar.wallet.dto.WalletBalanceResponse;
import com.luckystar.wallet.service.WalletService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/wallet")
public class WalletController {

    private final WalletService walletService;

    public WalletController(WalletService walletService) {
        this.walletService = walletService;
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
}
