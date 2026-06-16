package com.luckystar.notification.security;

import io.jsonwebtoken.Claims;
import io.jsonwebtoken.JwtException;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import java.nio.charset.StandardCharsets;
import javax.crypto.SecretKey;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * 驗證玩家 access token（與 member-service {@code JwtTokenProvider} 同一把 {@code jwt.secret}、
 * HS256 簽章）。STOMP CONNECT 時用來確認連線者身分並取出 playerId（JWT subject）。
 */
@Component
public class PlayerJwtVerifier {

    private static final Logger log = LoggerFactory.getLogger(PlayerJwtVerifier.class);

    private final SecretKey secretKey;

    public PlayerJwtVerifier(@Value("${jwt.secret}") String secret) {
        this.secretKey = Keys.hmacShaKeyFor(secret.getBytes(StandardCharsets.UTF_8));
    }

    /**
     * 驗章 + 驗 exp，成功回傳 playerId（subject）；失敗（含過期、簽章錯、格式錯）回傳 {@code null}。
     */
    public String verifyAndGetPlayerId(String token) {
        if (token == null || token.isBlank()) {
            return null;
        }
        try {
            Claims claims = Jwts.parser()
                    .verifyWith(secretKey)
                    .build()
                    .parseSignedClaims(token)
                    .getPayload();
            return claims.getSubject();
        } catch (JwtException | IllegalArgumentException e) {
            log.debug("STOMP CONNECT 拒絕：JWT 無效（{}）", e.getMessage());
            return null;
        }
    }
}
