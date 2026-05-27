package com.luckystar.member.controller;

import com.luckystar.member.dto.ApiResponse;
import com.luckystar.member.dto.ProfileResponse;
import com.luckystar.member.dto.UpdateProfileRequest;
import com.luckystar.member.service.PlayerService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1/player")
@RequiredArgsConstructor
public class PlayerController {

    private final PlayerService playerService;

    @GetMapping("/profile")
    public ResponseEntity<ApiResponse<ProfileResponse>> getProfile() {
        Long playerId = Long.parseLong(
                SecurityContextHolder.getContext().getAuthentication().getName());
        ProfileResponse profile = playerService.getProfile(playerId);
        return ResponseEntity.ok(ApiResponse.success(profile, "Profile retrieved"));
    }

    @PutMapping("/profile")
    public ResponseEntity<ApiResponse<ProfileResponse>> updateProfile(
            @Valid @RequestBody UpdateProfileRequest request) {
        Long playerId = Long.parseLong(
                SecurityContextHolder.getContext().getAuthentication().getName());
        ProfileResponse profile = playerService.updateProfile(playerId, request);
        return ResponseEntity.ok(ApiResponse.success(profile, "Profile updated"));
    }
}
