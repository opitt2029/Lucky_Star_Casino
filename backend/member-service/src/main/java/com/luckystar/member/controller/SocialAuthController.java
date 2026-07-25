package com.luckystar.member.controller;

import com.luckystar.member.dto.ApiResponse;
import com.luckystar.member.dto.LoginResponse;
import com.luckystar.member.dto.SocialLoginExchangeRequest;
import com.luckystar.member.dto.SocialLoginStartResponse;
import com.luckystar.member.service.SocialAuthService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.servlet.http.HttpSession;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.net.URI;

@RestController
@RequestMapping("/api/v1/auth/social")
@RequiredArgsConstructor
@Tag(name = "第三方登入", description = "Google、LINE、Apple OAuth/OIDC 登入")
public class SocialAuthController {

    private final SocialAuthService socialAuthService;

    @Operation(summary = "建立第三方登入授權網址")
    @PostMapping("/{provider}/start")
    public ResponseEntity<ApiResponse<SocialLoginStartResponse>> start(
            @PathVariable String provider) {
        return ResponseEntity.ok(ApiResponse.success(
                socialAuthService.startLogin(provider),
                "Social login started"));
    }

    @Operation(summary = "進入第三方 OAuth 授權流程")
    @GetMapping("/{provider}/authorize")
    public ResponseEntity<Void> authorize(
            @PathVariable String provider,
            @RequestParam(required = false) String bindingTicket,
            HttpSession session) {
        String location = socialAuthService.prepareAuthorization(
                provider,
                bindingTicket,
                session);
        return ResponseEntity.status(HttpStatus.FOUND)
                .header(HttpHeaders.LOCATION, URI.create(location).toString())
                .build();
    }

    @Operation(summary = "用一次性票據交換 Lucky Star JWT")
    @PostMapping("/exchange")
    public ResponseEntity<ApiResponse<LoginResponse>> exchange(
            @Valid @RequestBody SocialLoginExchangeRequest request) {
        return ResponseEntity.ok(ApiResponse.success(
                socialAuthService.exchangeLoginTicket(request.getTicket()),
                "Social login successful"));
    }
}
