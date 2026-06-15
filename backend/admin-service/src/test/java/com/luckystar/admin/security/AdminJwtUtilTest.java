package com.luckystar.admin.security;

import static org.assertj.core.api.Assertions.assertThat;

import io.jsonwebtoken.Claims;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import java.nio.charset.StandardCharsets;
import javax.crypto.SecretKey;
import org.junit.jupiter.api.Test;

class AdminJwtUtilTest {

    private static final String ADMIN_SECRET =
            "admin-secret-for-unit-test-please-change-1234567890-abcdef";
    private static final String PLAYER_SECRET =
            "player-secret-totally-different-1234567890-abcdef-xyz";

    private final AdminJwtUtil adminJwtUtil = new AdminJwtUtil(ADMIN_SECRET, 3600000L);

    @Test
    void generatedToken_isValidAndCarriesRoleAndAdminScope() {
        String token = adminJwtUtil.generateToken(7L, "superadmin", AdminRole.SUPER_ADMIN);

        assertThat(adminJwtUtil.validateToken(token)).isTrue();
        Claims claims = adminJwtUtil.getClaims(token);
        assertThat(claims.getSubject()).isEqualTo("7");
        assertThat(claims.get("role", String.class)).isEqualTo("SUPER_ADMIN");
        assertThat(claims.get("scope", String.class)).isEqualTo(AdminJwtUtil.SCOPE_ADMIN);
    }

    @Test
    void playerTokenSignedWithDifferentSecret_isRejected() {
        SecretKey playerKey = Keys.hmacShaKeyFor(PLAYER_SECRET.getBytes(StandardCharsets.UTF_8));
        String playerToken = Jwts.builder()
                .subject("1")
                .claim("role", "USER")
                .signWith(playerKey)
                .compact();

        assertThat(adminJwtUtil.validateToken(playerToken)).isFalse();
    }

    @Test
    void tokenWithoutAdminScope_isRejected() {
        // 即使用 admin secret 簽，但缺少 scope=admin 也視為無效（多一層語意隔離）
        SecretKey adminKey = Keys.hmacShaKeyFor(ADMIN_SECRET.getBytes(StandardCharsets.UTF_8));
        String noScope = Jwts.builder()
                .subject("1")
                .claim("role", "OPERATOR")
                .signWith(adminKey)
                .compact();

        assertThat(adminJwtUtil.validateToken(noScope)).isFalse();
    }

    @Test
    void garbageToken_isRejected() {
        assertThat(adminJwtUtil.validateToken("not-a-jwt")).isFalse();
    }
}
