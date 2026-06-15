package com.luckystar.game.fishing;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.redis.core.Cursor;
import org.springframework.data.redis.core.HashOperations;
import org.springframework.data.redis.core.ScanOptions;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;

/**
 * 捕魚機 Session 的 Redis 存取層。Key：{@code game:fishing:session:{playerId}}（Hash），
 * 每位玩家同時最多一個進行中場次。
 *
 * <p>TTL 取 24 小時作為安全網——實際回收由 {@link FishingService} 的閒置排程在
 * 閒置 10 分鐘時主動結算（把剩餘局內餘額還回 wallet），TTL 只防排程長期失效時 Redis 堆積。
 * 比照 {@code GameSessionService} 的 Hash 儲存風格。
 */
@Slf4j
@Component
public class FishingSessionStore {

    static final String KEY_PREFIX = "game:fishing:session:";
    private static final Duration TTL = Duration.ofHours(24);

    private static final String F_SESSION_ID = "sessionId";
    private static final String F_PLAYER_ID = "playerId";
    private static final String F_ROOM_ID = "roomId";
    private static final String F_SEAT_INDEX = "seatIndex";
    private static final String F_CANNON_LEVEL = "cannonLevel";
    private static final String F_BUY_IN = "buyIn";
    private static final String F_SESSION_BALANCE = "sessionBalance";
    private static final String F_TOTAL_BET = "totalBet";
    private static final String F_TOTAL_PAYOUT = "totalPayout";
    private static final String F_TOTAL_SHOTS = "totalShots";
    private static final String F_LAST_SHOT_SEQ = "lastShotSeq";
    private static final String F_SERVER_SEED = "serverSeed";
    private static final String F_SERVER_SEED_HASH = "serverSeedHash";
    private static final String F_CLIENT_SEED = "clientSeed";
    private static final String F_STATE = "state";
    private static final String F_CREATED_AT = "createdAt";
    private static final String F_LAST_ACTIVITY_AT = "lastActivityAt";

    private final StringRedisTemplate redisTemplate;
    private final HashOperations<String, String, String> hashOps;

    public FishingSessionStore(StringRedisTemplate redisTemplate) {
        this.redisTemplate = redisTemplate;
        this.hashOps = redisTemplate.opsForHash();
    }

    /** 寫入（覆蓋）整個 Session 並重設 TTL。 */
    public void save(FishingSession session) {
        String key = key(session.getPlayerId());
        hashOps.putAll(key, toHash(session));
        redisTemplate.expire(key, TTL);
    }

    /** 取得玩家目前的捕魚 Session（不存在/毀損回空）。 */
    public Optional<FishingSession> find(long playerId) {
        Map<String, String> hash = hashOps.entries(key(playerId));
        if (hash == null || hash.isEmpty()) {
            return Optional.empty();
        }
        try {
            return Optional.of(fromHash(hash));
        } catch (RuntimeException ex) {
            log.warn("解析 fishing session 失敗 playerId={}: {}", playerId, ex.toString());
            return Optional.empty();
        }
    }

    public boolean delete(long playerId) {
        return Boolean.TRUE.equals(redisTemplate.delete(key(playerId)));
    }

    /**
     * 列出所有捕魚 Session 的玩家 ID（閒置回收排程用）。
     *
     * <p>以 {@code SCAN} 游標分批掃描（非阻塞），避免 {@code KEYS} 在 key 量大時阻塞整個 Redis。
     * 每位玩家最多一個 key，掃描結果即在線場次清單。
     */
    public List<Long> listPlayerIds() {
        List<Long> playerIds = new ArrayList<>();
        ScanOptions options = ScanOptions.scanOptions().match(KEY_PREFIX + "*").count(256).build();
        try (Cursor<String> cursor = redisTemplate.scan(options)) {
            while (cursor.hasNext()) {
                String key = cursor.next();
                try {
                    playerIds.add(Long.parseLong(key.substring(KEY_PREFIX.length())));
                } catch (NumberFormatException ignored) {
                    // 非預期格式的 key，跳過
                }
            }
        }
        return playerIds;
    }

    static String key(long playerId) {
        return KEY_PREFIX + playerId;
    }

    private static Map<String, String> toHash(FishingSession s) {
        Map<String, String> h = new HashMap<>();
        putIfNotNull(h, F_SESSION_ID, s.getSessionId());
        putIfNotNull(h, F_PLAYER_ID, s.getPlayerId());
        putIfNotNull(h, F_ROOM_ID, s.getRoomId());
        putIfNotNull(h, F_SEAT_INDEX, s.getSeatIndex());
        putIfNotNull(h, F_CANNON_LEVEL, s.getCannonLevel());
        putIfNotNull(h, F_BUY_IN, s.getBuyIn());
        putIfNotNull(h, F_SESSION_BALANCE, s.getSessionBalance());
        putIfNotNull(h, F_TOTAL_BET, s.getTotalBet());
        putIfNotNull(h, F_TOTAL_PAYOUT, s.getTotalPayout());
        putIfNotNull(h, F_TOTAL_SHOTS, s.getTotalShots());
        putIfNotNull(h, F_LAST_SHOT_SEQ, s.getLastShotSeq());
        putIfNotNull(h, F_SERVER_SEED, s.getServerSeed());
        putIfNotNull(h, F_SERVER_SEED_HASH, s.getServerSeedHash());
        putIfNotNull(h, F_CLIENT_SEED, s.getClientSeed());
        putIfNotNull(h, F_STATE, s.getState());
        if (s.getCreatedAt() != null) {
            h.put(F_CREATED_AT, s.getCreatedAt().toString());
        }
        if (s.getLastActivityAt() != null) {
            h.put(F_LAST_ACTIVITY_AT, s.getLastActivityAt().toString());
        }
        return h;
    }

    private static FishingSession fromHash(Map<String, String> h) {
        return FishingSession.builder()
                .sessionId(h.get(F_SESSION_ID))
                .playerId(parseLong(h.get(F_PLAYER_ID)))
                .roomId(h.get(F_ROOM_ID))
                .seatIndex(parseInt(h.get(F_SEAT_INDEX)))
                .cannonLevel(parseInt(h.get(F_CANNON_LEVEL)))
                .buyIn(parseLong(h.get(F_BUY_IN)))
                .sessionBalance(parseLong(h.get(F_SESSION_BALANCE)))
                .totalBet(parseLong(h.get(F_TOTAL_BET)))
                .totalPayout(parseLong(h.get(F_TOTAL_PAYOUT)))
                .totalShots(parseLong(h.get(F_TOTAL_SHOTS)))
                .lastShotSeq(parseLong(h.get(F_LAST_SHOT_SEQ)))
                .serverSeed(h.get(F_SERVER_SEED))
                .serverSeedHash(h.get(F_SERVER_SEED_HASH))
                .clientSeed(h.get(F_CLIENT_SEED))
                .state(h.get(F_STATE))
                .createdAt(parseInstant(h.get(F_CREATED_AT)))
                .lastActivityAt(parseInstant(h.get(F_LAST_ACTIVITY_AT)))
                .build();
    }

    private static void putIfNotNull(Map<String, String> h, String field, Object value) {
        if (value != null) {
            h.put(field, String.valueOf(value));
        }
    }

    private static Long parseLong(String v) {
        return StringUtils.hasText(v) ? Long.valueOf(v) : null;
    }

    private static Integer parseInt(String v) {
        return StringUtils.hasText(v) ? Integer.valueOf(v) : null;
    }

    private static Instant parseInstant(String v) {
        return StringUtils.hasText(v) ? Instant.parse(v) : null;
    }
}
