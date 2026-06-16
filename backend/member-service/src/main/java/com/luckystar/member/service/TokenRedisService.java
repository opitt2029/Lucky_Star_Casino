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
    // 後台停用玩家標記（admin PlayerBanService 寫入、gateway 查詢）；member 登入時亦查此 key，
    // 停用期間不得重新登入。三方共用同一字串，不可改動。
    private static final String DISABLED_PLAYER_KEY_PREFIX = "disabled:player:";

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

    /** 玩家是否被後台停用（gateway 與 member 共用此封鎖標記）。 */
    public boolean isPlayerDisabled(Long memberId) {
        return Boolean.TRUE.equals(redisTemplate.hasKey(DISABLED_PLAYER_KEY_PREFIX + memberId));
    }
}
