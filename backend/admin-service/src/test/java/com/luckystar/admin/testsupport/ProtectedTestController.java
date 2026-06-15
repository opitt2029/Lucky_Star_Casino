package com.luckystar.admin.testsupport;

import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 測試專用受保護端點（僅 src/test，不進 production）。
 * 用來驗證 SecurityConfig 的 /admin/** 角色管控與方法級授權。
 */
@RestController
public class ProtectedTestController {

    /** /admin/** → 需 ROLE_ADMIN（SUPER_ADMIN / OPERATOR 皆可）。 */
    @GetMapping("/admin/ping")
    public String ping() {
        return "pong";
    }

    /** 敏感操作 → 僅 SUPER_ADMIN（比照 T-055 GM 發幣的授權模式）。 */
    @GetMapping("/admin/super-only")
    @PreAuthorize("hasRole('SUPER_ADMIN')")
    public String superOnly() {
        return "super";
    }
}
