package com.luckystar.wallet.controller;

import com.luckystar.wallet.common.ApiResponse;
import com.luckystar.wallet.dto.CreditRequest;
import com.luckystar.wallet.dto.CreditResponse;
import com.luckystar.wallet.dto.DebitRequest;
import com.luckystar.wallet.dto.DebitResponse;
import com.luckystar.wallet.service.WalletService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/internal/wallet")
@RequiredArgsConstructor
public class InternalWalletController {

    private final WalletService walletService;

    @PostMapping("/debit")
    public ResponseEntity<ApiResponse<DebitResponse>> debit(@Valid @RequestBody DebitRequest request) {
        DebitResponse response = walletService.debit(request);
        return ResponseEntity.ok(ApiResponse.ok(response));
    }

    @PostMapping("/credit")
    public ResponseEntity<ApiResponse<CreditResponse>> credit(@Valid @RequestBody CreditRequest request) {
        CreditResponse response = walletService.credit(request);
        return ResponseEntity.ok(ApiResponse.ok(response));
    }
}
