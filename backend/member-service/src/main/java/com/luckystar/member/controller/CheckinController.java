package com.luckystar.member.controller;

import com.luckystar.member.dto.ApiResponse;
import com.luckystar.member.dto.CheckinResponse;
import com.luckystar.member.dto.CheckinStatusResponse;
import com.luckystar.member.dto.MonthlyRewardClaimRequest;
import com.luckystar.member.dto.MonthlyRewardClaimResponse;
import com.luckystar.member.service.CheckinService;
import com.luckystar.member.service.MonthlyRewardService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/wallet")
@RequiredArgsConstructor
public class CheckinController {

    private final CheckinService checkinService;
    private final MonthlyRewardService monthlyRewardService;

    @PostMapping("/daily-checkin")
    public ResponseEntity<ApiResponse<CheckinResponse>> dailyCheckin() {
        Long playerId = currentPlayerId();
        CheckinResponse response = checkinService.checkin(playerId);
        return ResponseEntity.ok(ApiResponse.success(response, "Check-in successful"));
    }

    /** 簽到狀態（後端權威）：月曆已簽日期、本月累計天數、連續天數、月度里程碑領取旗標。 */
    @GetMapping("/checkin/status")
    public ResponseEntity<ApiResponse<CheckinStatusResponse>> checkinStatus(
            @RequestParam(name = "month", required = false) String month) {
        Long playerId = currentPlayerId();
        CheckinStatusResponse response = monthlyRewardService.getStatus(playerId, month);
        return ResponseEntity.ok(ApiResponse.ok(response));
    }

    /** 領取當月累計簽到里程碑獎勵。 */
    @PostMapping("/checkin/monthly-reward")
    public ResponseEntity<ApiResponse<MonthlyRewardClaimResponse>> claimMonthlyReward(
            @Valid @RequestBody MonthlyRewardClaimRequest request) {
        Long playerId = currentPlayerId();
        MonthlyRewardClaimResponse response =
                monthlyRewardService.claimMonthlyReward(playerId, request.milestoneDays());
        return ResponseEntity.ok(ApiResponse.success(response, "Monthly reward claimed"));
    }

    private Long currentPlayerId() {
        return Long.parseLong(SecurityContextHolder.getContext().getAuthentication().getName());
    }
}
