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

    public String generateAccessToken(Long memberId, String username) {
        return buildToken(memberId, username, accessTokenExpiryMs, "access");
    }

    public String generateRefreshToken(Long memberId, String username) {
        return buildToken(memberId, username, refreshTokenExpiryMs, "refresh");
    }

    private String buildToken(Long memberId, String username, long expiryMs, String type) {
        Date now = new Date();
        return Jwts.builder()
                .id(UUID.randomUUID().toString())
                .subject(String.valueOf(memberId))
                .claim("username", username)
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
