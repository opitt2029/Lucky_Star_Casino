package com.luckystar.admin.dto;

import jakarta.validation.constraints.NotBlank;

/** 後台登入請求（T-050）。 */
public record LoginRequest(
        @NotBlank String username,
        @NotBlank String password
) {}
