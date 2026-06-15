package com.luckystar.game.controller;

import com.luckystar.game.common.ApiResponse;
import com.luckystar.game.dto.VerificationResponse;
import com.luckystar.game.service.VerificationService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * RNG 公平性驗證 API（T-036）。對外前綴 {@code /api/v1/game/verify}。
 *
 * <p>玩家可獨立驗證某局結果是否被竄改：可選擇性帶入自己手上的 {@code serverSeed}，系統檢查其
 * 承諾雜湊並重算結果與紀錄比對。唯讀、不涉帳務，提供 Provably Fair 透明保證。
 */
@RestController
@RequestMapping("/api/v1/game/verify")
@RequiredArgsConstructor
public class VerificationController {

    private final VerificationService verificationService;

    /**
     * 驗證指定對局。
     *
     * @param roundId    對局識別碼
     * @param serverSeed 玩家提供的 serverSeed（選填；省略則用對局已揭露值）
     */
    @GetMapping("/{roundId}")
    public ResponseEntity<ApiResponse<VerificationResponse>> verify(
            @PathVariable String roundId,
            @RequestParam(value = "serverSeed", required = false) String serverSeed) {

        VerificationResponse result = verificationService.verify(roundId, serverSeed);
        return ResponseEntity.ok(ApiResponse.ok(result));
    }
}
