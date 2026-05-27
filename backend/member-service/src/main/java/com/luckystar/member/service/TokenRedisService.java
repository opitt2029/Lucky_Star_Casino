package com.luckystar.member.service;

import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;

import java.util.Optional;
import java.util.concurrent.TimeUnit;

@Service
public class TokenRedisService {

    private final StringRedisTemplate redisTemplate;

    public TokenRedisService(StringRedisTemplate redisTemplate) {
        this.redisTemplate = redisTemplate;
    }

    public void saveRefreshToken(Long memberId, String refreshToken, long ttlMs) {
        redisTemplate.opsForValue()
                .set(refreshKey(memberId), refreshToken, ttlMs, TimeUnit.MILLISECONDS);
    }

    public Optional<String> getRefreshToken(Long memberId) {
        return Optional.ofNullable(redisTemplate.opsForValue().get(refreshKey(memberId)));
    }

    public void deleteRefreshToken(Long memberId) {
        redisTemplate.delete(refreshKey(memberId));
    }

    public void addToBlacklist(String jti, long remainingTtlMs) {
        redisTemplate.opsForValue()
                .set(blacklistKey(jti), "1", remainingTtlMs, TimeUnit.MILLISECONDS);
    }

    public boolean isBlacklisted(String jti) {
        return Boolean.TRUE.equals(redisTemplate.hasKey(blacklistKey(jti)));
    }

    private String refreshKey(Long memberId) {
        return "refresh:" + memberId;
    }

    private String blacklistKey(String jti) {
        return "blacklist:" + jti;
    }
}
