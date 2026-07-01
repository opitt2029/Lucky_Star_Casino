package com.luckystar.admin.service;

import java.time.Duration;
import java.time.Instant;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;

/**
 * 玩家使用者級封鎖（T-051）。
 *
 * 後台停用玩家時於 Redis 寫入三件事，皆由其他服務消費，達成「停用即時生效、啟用後舊憑證不復活」：
 * <ol>
 *   <li>{@code disabled:player:{id}}：<b>gateway</b> 全域 JWT filter 命中即 401，使該玩家既有 token
 *       立刻失效；同時 <b>member</b> 登入時也查此 key，停用期間不得重新登入。啟用時刪除。</li>
 *   <li>{@code token:min-iat:{id}}：記錄停用時間點（epoch 秒）。gateway 對該玩家拒絕「簽發時間 iat
 *       早於此值」的 token——即使日後啟用刪除了封鎖 key，停用前簽發的舊 token 也永久失效（解決
 *       「啟用後舊 token 復活」）。啟用時<b>不刪</b>，靠 TTL（= refresh token 最長壽命）自然清除。</li>
 *   <li>刪除 {@code refresh:{id}}：作廢該玩家既有 refresh token，避免停用前的 refresh token 在啟用後
 *       透過 {@code /auth/refresh} 換發出 iat 較新的 access token 繞過上一條規則。</li>
 * </ol>
 *
 * 註：與 member-service 共用同一 Redis，key 命名須與 member（{@code refresh:}）、gateway
 * （{@code disabled:player:}、{@code token:min-iat:}）一致，否則撤銷不會生效。
 */
@Service
public class PlayerBanService {

    public static final String DISABLED_PLAYER_KEY_PREFIX = "disabled:player:";
    public static final String TOKEN_MIN_IAT_KEY_PREFIX = "token:min-iat:";
    /** member 寫入的 refresh token key 前綴（須與 member TokenRedisService 一致）。 */
    public static final String REFRESH_KEY_PREFIX = "refresh:";
    /** min-iat 標記保留時間：取 refresh token 最長壽命（7 天），過後停用前的 token 必已過期，key 可自然清除。 */
    private static final Duration MIN_IAT_TTL = Duration.ofDays(7);

    private final StringRedisTemplate redisTemplate;

    public PlayerBanService(StringRedisTemplate redisTemplate) {
        this.redisTemplate = redisTemplate;
    }

    public void ban(Long playerId) {
        redisTemplate.opsForValue().set(disabledKey(playerId), "1");
        redisTemplate.opsForValue().set(
                minIatKey(playerId),
                String.valueOf(Instant.now().getEpochSecond()),
                MIN_IAT_TTL);
        // 作廢既有 refresh token：停用前的 refresh token 不得在啟用後換發新 access token
        redisTemplate.delete(REFRESH_KEY_PREFIX + playerId);
    }

    public void unban(Long playerId) {
        // 僅解除即時封鎖；保留 token:min-iat，使停用前簽發的舊 token 不會因啟用而復活（靠 TTL 清除）
        redisTemplate.delete(disabledKey(playerId));
    }

    public boolean isBanned(Long playerId) {
        return Boolean.TRUE.equals(redisTemplate.hasKey(disabledKey(playerId)));
    }

    private String disabledKey(Long playerId) {
        return DISABLED_PLAYER_KEY_PREFIX + playerId;
    }

    private String minIatKey(Long playerId) {
        return TOKEN_MIN_IAT_KEY_PREFIX + playerId;
    }
}
