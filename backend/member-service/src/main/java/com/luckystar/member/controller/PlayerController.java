package com.luckystar.member.controller;

import com.luckystar.member.dto.ApiResponse;
import com.luckystar.member.dto.ProfileResponse;
import com.luckystar.member.dto.UpdateProfileRequest;
import com.luckystar.member.service.PlayerService;
import jakarta.validation.Valid;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1/player")
public class PlayerController {

    private final PlayerService playerService;

    public PlayerController(PlayerService playerService) {
        this.playerService = playerService;
    }

    @GetMapping("/profile")
    public ResponseEntity<ApiResponse<ProfileResponse>> getProfile() {
        Long memberId = Long.parseLong(
                SecurityContextHolder.getContext().getAuthentication().getName()
        );
        ProfileResponse response = playerService.getProfile(memberId);
        return ResponseEntity.ok(ApiResponse.success(response, "Profile retrieved"));
    }

    @PutMapping("/profile")
    public ResponseEntity<ApiResponse<ProfileResponse>> updateProfile(
            @Valid @RequestBody UpdateProfileRequest request) {
        Long memberId = Long.parseLong(
                SecurityContextHolder.getContext().getAuthentication().getName()
        );
        ProfileResponse response = playerService.updateProfile(memberId, request);
        return ResponseEntity.ok(ApiResponse.success(response, "Profile updated"));
    }
}
