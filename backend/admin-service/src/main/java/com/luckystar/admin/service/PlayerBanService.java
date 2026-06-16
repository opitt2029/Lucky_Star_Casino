package com.luckystar.admin.service;

import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;

/**
 * 玩家使用者級封鎖（T-051）。
 *
 * 後台停用玩家時寫入 Redis key {@code disabled:player:{playerId}}，由 <b>gateway</b> 全域 JWT
 * filter 檢查 → 命中即 401，使該玩家既有 token 立刻失效（per-JTI 黑名單無法做到使用者級封鎖）。
 * 啟用時刪除 key。無 TTL：封鎖持續到後台手動啟用。
 *
 * 註：member 庫 {@code status} 欄位的持久化由 member-service internal API 負責（尚未提供），
 * 此處僅處理「即時失效」的 Redis 封鎖；兩者解耦。
 */
@Service
public class PlayerBanService {

    public static final String DISABLED_PLAYER_KEY_PREFIX = "disabled:player:";

    private final StringRedisTemplate redisTemplate;

    public PlayerBanService(StringRedisTemplate redisTemplate) {
        this.redisTemplate = redisTemplate;
    }

    public void ban(Long playerId) {
        redisTemplate.opsForValue().set(key(playerId), "1");
    }

    public void unban(Long playerId) {
        redisTemplate.delete(key(playerId));
    }

    public boolean isBanned(Long playerId) {
        return Boolean.TRUE.equals(redisTemplate.hasKey(key(playerId)));
    }

    private String key(Long playerId) {
        return DISABLED_PLAYER_KEY_PREFIX + playerId;
    }
}
