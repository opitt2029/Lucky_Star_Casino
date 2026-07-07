package com.luckystar.member.dto;

import jakarta.validation.constraints.NotNull;
import lombok.Getter;
import lombok.Setter;

/**
 * 內部 API：更新會員帳號狀態（T-051 補完，admin-service 停用/啟用玩家時呼叫）。
 * 只收 enabled 布林，狀態字串（ACTIVE / DISABLED）由 member 端對映，避免呼叫方寫入未知狀態值。
 */
@Getter
@Setter
public class UpdateMemberStatusRequest {

    @NotNull(message = "enabled is required")
    private Boolean enabled;
}
