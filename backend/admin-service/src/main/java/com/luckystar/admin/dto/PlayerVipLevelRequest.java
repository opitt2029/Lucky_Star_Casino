package com.luckystar.admin.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;

/** 變更玩家會員等級請求：NORMAL（一般）或 VIP（gateway 限流走寬鬆桶）。 */
public record PlayerVipLevelRequest(
        @NotBlank
        @Pattern(regexp = "NORMAL|VIP", message = "vipLevel must be NORMAL or VIP")
        String vipLevel
) {}
