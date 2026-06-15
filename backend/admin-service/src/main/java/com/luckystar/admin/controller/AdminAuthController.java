package com.luckystar.admin.controller;

import com.luckystar.admin.dto.LoginRequest;
import com.luckystar.admin.dto.LoginResponse;
import com.luckystar.admin.service.AdminAuthService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.security.SecurityRequirements;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 後台登入 API（T-050）。{@code /admin/auth/**} 在 SecurityConfig 為 permitAll。
 */
@Tag(name = "後台登入", description = "T-050 後台帳號登入，簽發 ADMIN JWT")
@RestController
@RequestMapping("/admin/auth")
public class AdminAuthController {

    private final AdminAuthService adminAuthService;

    public AdminAuthController(AdminAuthService adminAuthService) {
        this.adminAuthService = adminAuthService;
    }

    @Operation(summary = "後台登入", description = "驗證帳密成功後回傳 ADMIN JWT；失敗回 401。此端點無需帶 token。")
    @SecurityRequirements
    @PostMapping("/login")
    public ResponseEntity<LoginResponse> login(@Valid @RequestBody LoginRequest request) {
        return adminAuthService.login(request.username(), request.password())
                .map(ResponseEntity::ok)
                .orElseGet(() -> ResponseEntity.status(HttpStatus.UNAUTHORIZED).build());
    }
}
