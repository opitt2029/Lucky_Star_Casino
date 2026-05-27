package com.luckystar.member.controller;

import com.luckystar.member.dto.*;
import com.luckystar.member.service.AuthService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1/auth")
@RequiredArgsConstructor
public class AuthController {

    private final AuthService authService;

    @PostMapping("/register")
    public ResponseEntity<ApiResponse<RegisterResponse>> register(
            @Valid @RequestBody RegisterRequest request) {
        RegisterResponse response = authService.register(request);
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(ApiResponse.success(response, "Registration successful"));
    }

    @PostMapping("/login")
    public ResponseEntity<ApiResponse<LoginResponse>> login(
            @Valid @RequestBody LoginRequest request) {
        LoginResponse response = authService.login(request);
        return ResponseEntity.ok(ApiResponse.success(response, "Login successful"));
    }

    @PostMapping("/logout")
    public ResponseEntity<ApiResponse<Void>> logout(
            @RequestHeader("Authorization") String authorizationHeader,
            Authentication authentication) {
        Long memberId = Long.parseLong(authentication.getName());
        authService.logout(authorizationHeader, memberId);
        return ResponseEntity.ok(ApiResponse.success(null, "Logout successful"));
    }

    @PostMapping("/refresh")
    public ResponseEntity<ApiResponse<RefreshResponse>> refresh(
            @Valid @RequestBody RefreshRequest request) {
        RefreshResponse response = authService.refreshToken(request);
        return ResponseEntity.ok(ApiResponse.success(response, "Token refreshed"));
    }
}
