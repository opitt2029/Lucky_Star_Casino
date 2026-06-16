package com.luckystar.notification.security;

import static org.assertj.core.api.Assertions.assertThat;

import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import java.nio.charset.StandardCharsets;
import java.util.Date;
import javax.crypto.SecretKey;
import org.junit.jupiter.api.Test;

class PlayerJwtVerifierTest {

    private static final String SECRET = "test-notification-jwt-secret-please-change-0123456789";
    private final SecretKey key = Keys.hmacShaKeyFor(SECRET.getBytes(StandardCharsets.UTF_8));
    private final PlayerJwtVerifier verifier = new PlayerJwtVerifier(SECRET);

    @Test
    void validToken_returnsSubjectAsPlayerId() {
        String token = Jwts.builder()
                .subject("42")
                .claim("role", "PLAYER")
                .issuedAt(new Date())
                .expiration(new Date(System.currentTimeMillis() + 60_000))
                .signWith(key)
                .compact();

        assertThat(verifier.verifyAndGetPlayerId(token)).isEqualTo("42");
    }

    @Test
    void expiredToken_returnsNull() {
        String token = Jwts.builder()
                .subject("42")
                .issuedAt(new Date(System.currentTimeMillis() - 120_000))
                .expiration(new Date(System.currentTimeMillis() - 60_000))
                .signWith(key)
                .compact();

        assertThat(verifier.verifyAndGetPlayerId(token)).isNull();
    }

    @Test
    void wrongSignature_returnsNull() {
        SecretKey otherKey = Keys.hmacShaKeyFor(
                "another-totally-different-secret-key-0123456789ab".getBytes(StandardCharsets.UTF_8));
        String token = Jwts.builder()
                .subject("42")
                .expiration(new Date(System.currentTimeMillis() + 60_000))
                .signWith(otherKey)
                .compact();

        assertThat(verifier.verifyAndGetPlayerId(token)).isNull();
    }

    @Test
    void nullOrBlankToken_returnsNull() {
        assertThat(verifier.verifyAndGetPlayerId(null)).isNull();
        assertThat(verifier.verifyAndGetPlayerId("   ")).isNull();
        assertThat(verifier.verifyAndGetPlayerId("not-a-jwt")).isNull();
    }
}
