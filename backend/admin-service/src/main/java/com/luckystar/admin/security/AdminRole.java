package com.luckystar.admin.security;

/**
 * 後台管理員角色（T-050）。
 *
 * <ul>
 *   <li>{@code SUPER_ADMIN}：最高權限，含 GM 發幣等敏感操作（{@code @PreAuthorize("hasRole('SUPER_ADMIN')")}）。</li>
 *   <li>{@code OPERATOR}：一般營運，可查報表/管理玩家，但不可執行 SUPER_ADMIN 限定操作。</li>
 * </ul>
 *
 * 兩者皆會被授予 {@code ROLE_ADMIN}（保護 /admin/**），另各自授予 {@code ROLE_<name>}。
 */
public enum AdminRole {
    SUPER_ADMIN,
    OPERATOR
}
