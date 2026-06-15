package com.luckystar.admin.dto;

import jakarta.validation.constraints.NotNull;

/** 變更玩家狀態請求（T-051）：{@code enabled=false} 為停用、{@code true} 為啟用。 */
public record PlayerStatusRequest(
        @NotNull Boolean enabled
) {}
