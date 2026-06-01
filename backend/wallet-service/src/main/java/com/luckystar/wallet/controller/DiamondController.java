package com.luckystar.wallet.controller;

import com.luckystar.wallet.common.ApiResponse;
import com.luckystar.wallet.dto.DiamondRedeemRequest;
import com.luckystar.wallet.dto.DiamondRedeemResponse;
import com.luckystar.wallet.service.DiamondRedeemService;
import jakarta.validation.Valid;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 鑽石系統 API（T-102）。與星幣的 {@link WalletController} 分開，讓鑽石邏輯獨立演進
 * （比照 {@link com.luckystar.wallet.service.DiamondWalletService} 的設計取向）。
 */
@RestController
@RequestMapping("/api/v1/wallet/diamond")
public class DiamondController {

    private final DiamondRedeemService diamondRedeemService;

    public DiamondController(DiamondRedeemService diamondRedeemService) {
        this.diamondRedeemService = diamondRedeemService;
    }

    /**
     * 點數卡序號兌換鑽石（T-102）。玩家輸入 {@code card_code}，驗證序號存在且未兌換後，原子標記序號並把面額
     * 入帳到鑽石餘額，回傳兌換後鑽石餘額。
     *
     * <p>玩家身分由 gateway 注入的 {@code X-User-Id} header 決定（鑽石只能入到自己帳上）；序號走 body。
     *
     * <p>錯誤對應：序號不存在 → 404；序號已兌換（含並發重複兌換）→ 422；鑽石錢包不存在 → 404；
     * 並發樂觀鎖衝突 → 409（皆由 {@link com.luckystar.wallet.exception.GlobalExceptionHandler} 統一處理）。
     */
    @PostMapping("/redeem")
    public ResponseEntity<ApiResponse<DiamondRedeemResponse>> redeem(
            @RequestHeader(value = "X-User-Id", required = false) String playerIdStr,
            @Valid @RequestBody DiamondRedeemRequest request) {

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

        DiamondRedeemResponse response = diamondRedeemService.redeem(playerId, request.getCardCode());
        return ResponseEntity.ok(ApiResponse.ok(response));
    }
}
