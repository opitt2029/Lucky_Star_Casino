package com.luckystar.admin.dto;

/** 後台登入回應（T-050）：回傳後台 JWT 與角色。 */
public record LoginResponse(
        String accessToken,
        String tokenType,
        long expiresInMs,
        String username,
        String role
) {}
