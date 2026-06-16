package com.luckystar.member.service;

import lombok.RequiredArgsConstructor;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;

import java.time.Duration;

@Service
@RequiredArgsConstructor
public class TokenRedisService {

    private static final String REFRESH_KEY_PREFIX = "refresh:";
    // 必須與 gateway-service JwtAuthenticationGlobalFilter 的 BLACKLIST_KEY_PREFIX 一致，
    // 否則登出寫入的黑名單在 Gateway 端查不到、撤銷不會生效（兩者都用 jwt:blacklist:{jti}）。
    private static final String BLACKLIST_KEY_PREFIX = "jwt:blacklist:";

    private final StringRedisTemplate redisTemplate;

    public void saveRefreshToken(Long memberId, String token, long ttlMs) {
        redisTemplate.opsForValue().set(
                REFRESH_KEY_PREFIX + memberId,
                token,
                Duration.ofMillis(ttlMs)
        );
    }

    public String getRefreshToken(Long memberId) {
        return redisTemplate.opsForValue().get(REFRESH_KEY_PREFIX + memberId);
    }

    public void deleteRefreshToken(Long memberId) {
        redisTemplate.delete(REFRESH_KEY_PREFIX + memberId);
    }

    public void addToBlacklist(String jti, long ttlMs) {
        redisTemplate.opsForValue().set(
                BLACKLIST_KEY_PREFIX + jti,
                "1",
                Duration.ofMillis(ttlMs)
        );
    }

    public boolean isBlacklisted(String jti) {
        return Boolean.TRUE.equals(redisTemplate.hasKey(BLACKLIST_KEY_PREFIX + jti));
    }
}
