package com.luckystar.member.controller;

import com.luckystar.member.dto.ApiResponse;
import com.luckystar.member.dto.CompleteSocialBindingRequest;
import com.luckystar.member.dto.ProfileResponse;
import com.luckystar.member.dto.SocialBindingResponse;
import com.luckystar.member.dto.SocialBindingStartResponse;
import com.luckystar.member.dto.UpdateProfileRequest;
import com.luckystar.member.service.PlayerService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequestMapping("/api/v1/player")
@RequiredArgsConstructor
public class PlayerController {

    private final PlayerService playerService;

    @GetMapping("/profile")
    public ResponseEntity<ApiResponse<ProfileResponse>> getProfile() {
        ProfileResponse profile = playerService.getProfile(currentPlayerId());
        return ResponseEntity.ok(ApiResponse.success(profile, "Profile retrieved"));
    }

    @PutMapping("/profile")
    public ResponseEntity<ApiResponse<ProfileResponse>> updateProfile(
            @Valid @RequestBody UpdateProfileRequest request) {
        ProfileResponse profile = playerService.updateProfile(currentPlayerId(), request);
        return ResponseEntity.ok(ApiResponse.success(profile, "Profile updated"));
    }

    @GetMapping("/social-bindings")
    public ResponseEntity<ApiResponse<List<SocialBindingResponse>>> getSocialBindings() {
        return ResponseEntity.ok(ApiResponse.success(
                playerService.getSocialBindings(currentPlayerId()),
                "Social bindings retrieved"));
    }

    @PostMapping("/social-bindings/{provider}/start")
    public ResponseEntity<ApiResponse<SocialBindingStartResponse>> startSocialBinding(
            @PathVariable String provider) {
        return ResponseEntity.ok(ApiResponse.success(
                playerService.startSocialBinding(currentPlayerId(), provider),
                "Social binding started"));
    }

    @PostMapping("/social-bindings/{provider}/complete")
    public ResponseEntity<ApiResponse<SocialBindingResponse>> completeSocialBinding(
            @PathVariable String provider,
            @Valid @RequestBody(required = false) CompleteSocialBindingRequest request) {
        String externalAccountId = request != null ? request.getExternalAccountId() : null;
        return ResponseEntity.ok(ApiResponse.success(
                playerService.completeSocialBinding(currentPlayerId(), provider, externalAccountId),
                "Social binding completed"));
    }

    @DeleteMapping("/social-bindings/{provider}")
    public ResponseEntity<ApiResponse<SocialBindingResponse>> removeSocialBinding(
            @PathVariable String provider) {
        return ResponseEntity.ok(ApiResponse.success(
                playerService.removeSocialBinding(currentPlayerId(), provider),
                "Social binding removed"));
    }

    private Long currentPlayerId() {
        return Long.parseLong(SecurityContextHolder.getContext().getAuthentication().getName());
    }
}
