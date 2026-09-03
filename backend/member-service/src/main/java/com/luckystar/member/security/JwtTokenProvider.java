package com.luckystar.member.security;

import io.jsonwebtoken.*;
import io.jsonwebtoken.security.Keys;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import javax.crypto.SecretKey;
import java.nio.charset.StandardCharsets;
import java.util.Date;
import java.util.UUID;

@Slf4j
@Component
public class JwtTokenProvider {

    private final SecretKey secretKey;
    private final long accessTokenExpiryMs;
    private final long refreshTokenExpiryMs;

    public JwtTokenProvider(
            @Value("${jwt.secret}") String secret,
            @Value("${jwt.access-token-expiry-ms}") long accessTokenExpiryMs,
            @Value("${jwt.refresh-token-expiry-ms}") long refreshTokenExpiryMs) {
        this.secretKey = Keys.hmacShaKeyFor(secret.getBytes(StandardCharsets.UTF_8));
        this.accessTokenExpiryMs = accessTokenExpiryMs;
        this.refreshTokenExpiryMs = refreshTokenExpiryMs;
    }

    public String generateAccessToken(Long memberId, String username, String role, String tier) {
        return buildToken(memberId, username, role, tier, accessTokenExpiryMs, "access");
    }

    public String generateRefreshToken(Long memberId, String username, String role, String tier) {
        return buildToken(memberId, username, role, tier, refreshTokenExpiryMs, "refresh");
    }

    /**
     * tier（會員等級，members.vip_level）與 role 一樣是簽在 token 裡的身分屬性，
     * gateway 只拿它決定每玩家限流桶要用哪組參數——不是授權依據，也不影響任何權限判定。
     * 因為是簽發時快照，降級最長會有一個 access token 效期的延遲（同 role 的既有性質）。
     */
    private String buildToken(Long memberId, String username, String role, String tier,
                              long expiryMs, String type) {
        Date now = new Date();
        return Jwts.builder()
                .id(UUID.randomUUID().toString())
                .subject(String.valueOf(memberId))
                .claim("username", username)
                .claim("role", role)
                .claim("tier", tier)
                .claim("type", type)
                .issuedAt(now)
                .expiration(new Date(now.getTime() + expiryMs))
                .signWith(secretKey)
                .compact();
    }

    public boolean validateToken(String token) {
        try {
            Jwts.parser().verifyWith(secretKey).build().parseSignedClaims(token);
            return true;
        } catch (JwtException | IllegalArgumentException e) {
            log.debug("Invalid JWT token: {}", e.getMessage());
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

    public String getJti(String token) {
        return getClaims(token).getId();
    }

    public long getRemainingTtlMs(String token) {
        Date expiration = getClaims(token).getExpiration();
        return Math.max(0, expiration.getTime() - System.currentTimeMillis());
    }
}
