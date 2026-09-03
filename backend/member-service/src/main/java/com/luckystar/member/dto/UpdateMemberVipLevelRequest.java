package com.luckystar.member.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import lombok.Getter;
import lombok.Setter;

/**
 * 內部 API：更新會員等級（admin-service 設定/撤銷 VIP 時呼叫）。
 *
 * <p>用等級字串而非布林（相對於 {@link UpdateMemberStatusRequest} 的 enabled），因為
 * {@code members.vip_level} 本質是列舉欄位；{@code @Pattern} 同樣擋掉未知值，
 * 日後要加第三級只需放寬 regex，不必改 API 形狀。</p>
 */
@Getter
@Setter
public class UpdateMemberVipLevelRequest {

    @NotBlank(message = "vipLevel is required")
    @Pattern(regexp = "NORMAL|VIP", message = "vipLevel must be NORMAL or VIP")
    private String vipLevel;
}
