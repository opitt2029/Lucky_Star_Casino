package com.luckystar.admin.security;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import java.nio.charset.StandardCharsets;
import javax.crypto.SecretKey;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.web.servlet.MockMvc;

/**
 * T-050 驗收：/admin/** 存取管控 + 角色區分 + secret 隔離 + 登入 e2e。
 * 使用 H2（test application.yml）與啟動播種的預設 SUPER_ADMIN。
 */
@SpringBootTest
@AutoConfigureMockMvc
class AdminSecurityIntegrationTest {

    @Autowired
    MockMvc mockMvc;

    @Autowired
    AdminJwtUtil adminJwtUtil;

    private String bearer(String token) {
        return "Bearer " + token;
    }

    // ── 未認證 / secret 隔離 → 401 ─────────────────────────────────────────────

    @Test
    void noToken_returns401() throws Exception {
        mockMvc.perform(get("/admin/ping")).andExpect(status().isUnauthorized());
    }

    @Test
    void playerTokenWithDifferentSecret_returns401() throws Exception {
        SecretKey playerKey = Keys.hmacShaKeyFor(
                "player-secret-different-from-admin-1234567890-abcdefxyz".getBytes(StandardCharsets.UTF_8));
        String playerToken = Jwts.builder()
                .subject("1")
                .claim("role", "USER")
                .claim("scope", "player")
                .signWith(playerKey)
                .compact();

        mockMvc.perform(get("/admin/ping").header("Authorization", bearer(playerToken)))
                .andExpect(status().isUnauthorized());
    }

    // ── admin token → 200；角色區分 → 403 ─────────────────────────────────────

    @Test
    void operatorToken_canAccessAdminEndpoint() throws Exception {
        String token = adminJwtUtil.generateToken(2L, "operator", AdminRole.OPERATOR);
        mockMvc.perform(get("/admin/ping").header("Authorization", bearer(token)))
                .andExpect(status().isOk());
    }

    @Test
    void operatorToken_cannotAccessSuperOnlyEndpoint_returns403() throws Exception {
        String token = adminJwtUtil.generateToken(2L, "operator", AdminRole.OPERATOR);
        mockMvc.perform(get("/admin/super-only").header("Authorization", bearer(token)))
                .andExpect(status().isForbidden());
    }

    @Test
    void superAdminToken_canAccessSuperOnlyEndpoint() throws Exception {
        String token = adminJwtUtil.generateToken(1L, "superadmin", AdminRole.SUPER_ADMIN);
        mockMvc.perform(get("/admin/super-only").header("Authorization", bearer(token)))
                .andExpect(status().isOk());
    }

    // ── 登入 e2e（播種的 SUPER_ADMIN）────────────────────────────────────────

    @Test
    void login_withSeededSuperAdmin_returns200() throws Exception {
        mockMvc.perform(post("/admin/auth/login")
                        .contentType("application/json")
                        .content("{\"username\":\"superadmin\",\"password\":\"test-admin-pass\"}"))
                .andExpect(status().isOk());
    }

    @Test
    void login_withWrongPassword_returns401() throws Exception {
        mockMvc.perform(post("/admin/auth/login")
                        .contentType("application/json")
                        .content("{\"username\":\"superadmin\",\"password\":\"nope\"}"))
                .andExpect(status().isUnauthorized());
    }
}
