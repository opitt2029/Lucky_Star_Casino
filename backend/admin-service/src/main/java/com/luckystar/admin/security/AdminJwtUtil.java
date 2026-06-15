package com.luckystar.admin.security;

import io.jsonwebtoken.Claims;
import io.jsonwebtoken.JwtException;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import java.nio.charset.StandardCharsets;
import java.util.Date;
import java.util.UUID;
import javax.crypto.SecretKey;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * 後台 JWT 簽發 / 驗章（T-050）。
 *
 * 採 <b>獨立</b> {@code admin.jwt.secret}（對應 {@code ADMIN_JWT_SECRET}），與玩家 {@code JWT_SECRET}
 * 分離（AGENTS §地雷）：玩家 token 因 secret 不同 → 驗章失敗 → 無法存取 /admin/**。
 */
@Component
public class AdminJwtUtil {

    private static final Logger log = LoggerFactory.getLogger(AdminJwtUtil.class);

    /** 標記此 token 為後台用途，與玩家 token 再多一層語意區隔。 */
    public static final String SCOPE_ADMIN = "admin";

    private final SecretKey secretKey;
    private final long expiryMs;

    public AdminJwtUtil(
            @Value("${admin.jwt.secret}") String secret,
            @Value("${admin.jwt.expiry-ms}") long expiryMs) {
        this.secretKey = Keys.hmacShaKeyFor(secret.getBytes(StandardCharsets.UTF_8));
        this.expiryMs = expiryMs;
    }

    public String generateToken(Long adminId, String username, AdminRole role) {
        Date now = new Date();
        return Jwts.builder()
                .id(UUID.randomUUID().toString())
                .subject(String.valueOf(adminId))
                .claim("username", username)
                .claim("role", role.name())
                .claim("scope", SCOPE_ADMIN)
                .issuedAt(now)
                .expiration(new Date(now.getTime() + expiryMs))
                .signWith(secretKey)
                .compact();
    }

    public boolean validateToken(String token) {
        try {
            Claims claims = getClaims(token);
            return SCOPE_ADMIN.equals(claims.get("scope", String.class));
        } catch (JwtException | IllegalArgumentException e) {
            log.debug("Invalid admin JWT: {}", e.getMessage());
            return false;
        }
    }

    public Claims getClaims(String token) {
        return Jwts.parser()
                .verifyWith(secretKey)
                .build()
                .parseSignedClaims(token)
                .getPayload();
    }

    public long getExpiryMs() {
        return expiryMs;
    }
}
