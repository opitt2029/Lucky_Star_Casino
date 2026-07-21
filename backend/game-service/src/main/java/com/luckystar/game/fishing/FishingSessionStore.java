package com.luckystar.game.fishing;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.redis.core.Cursor;
import org.springframework.data.redis.core.HashOperations;
import org.springframework.data.redis.core.ScanOptions;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.data.redis.core.script.RedisScript;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;

/**
 * 捕魚機 Session 的 Redis 存取層。Key：{@code game:fishing:session:{playerId}}（Hash），
 * 每位玩家同時最多一個進行中場次。
 *
 * <p>TTL 取 24 小時作為安全網——實際回收由 {@link FishingService} 的閒置排程在
 * 閒置 10 分鐘時主動結算（把剩餘局內餘額還回 wallet），TTL 只防排程長期失效時 Redis 堆積。
 * 比照 {@code GameSessionService} 的 Hash 儲存風格。
 *
 * <p><b>寫入原子化（ADR-008）</b>：{@link #save} 為單純覆寫（僅供建立全新 session 的
 * {@code FishingService.start} 使用，無併發改寫風險）。凡「讀→改→整包寫回」的路徑
 * （shots/top-up）一律走 {@link #saveCas}——以 {@code version} 欄位做樂觀鎖，取代舊版單純
 * 依賴前端 {@code topUpLockRef} 迴避覆寫（該鎖仍保留作 UX 最佳化，見 AGENTS.md 雷區 16）。
 */
@Slf4j
@Component
public class FishingSessionStore {

    static final String KEY_PREFIX = "game:fishing:session:";
    private static final Duration TTL = Duration.ofHours(24);

    /**
     * 樂觀鎖 CAS：{@code version} 欄位與 {@code ARGV[1]} 相符才整包覆寫（含新 version）＋續 TTL，
     * 否則不動 key、回傳 0。缺 {@code version} 欄位（升級前的舊 session）視同 0。
     * ARGV 版面：[1]=期望舊版本, [2]=TTL 毫秒, [3..]=field/value 成對清單（含新 version）。
     */
    private static final RedisScript<Long> SAVE_CAS_SCRIPT = new DefaultRedisScript<>("""
            local current = redis.call('HGET', KEYS[1], 'version')
            if current == false then
                current = '0'
            end
            if current ~= ARGV[1] then
                return 0
            end
            for i = 3, #ARGV, 2 do
                redis.call('HSET', KEYS[1], ARGV[i], ARGV[i + 1])
            end
            redis.call('PEXPIRE', KEYS[1], ARGV[2])
            return 1
            """, Long.class);

    private static final String F_SESSION_ID = "sessionId";
    private static final String F_PLAYER_ID = "playerId";
    private static final String F_ROOM_ID = "roomId";
    private static final String F_SEAT_INDEX = "seatIndex";
    private static final String F_CANNON_LEVEL = "cannonLevel";
    private static final String F_BET_PER_SHOT = "betPerShot";
    private static final String F_BUY_IN = "buyIn";
    private static final String F_BALANCE_BEFORE = "balanceBefore";
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
    private static final String F_INTERCEPTED = "intercepted";
    private static final String F_FISH_DAMAGE = "fishDamage";
    private static final String F_FISH_RECOVERY = "fishRecovery";
    private static final String F_KILLS = "kills";
    private static final String F_TOP_UP_REQUEST_IDS = "topUpRequestIds";
    private static final String F_VERSION = "version";

    private static final TypeReference<LinkedHashMap<String, Long>> FISH_DAMAGE_TYPE =
            new TypeReference<>() {};
    private static final TypeReference<List<FishingSession.KillRecord>> KILLS_TYPE =
            new TypeReference<>() {};
    private static final TypeReference<List<String>> TOP_UP_IDS_TYPE =
            new TypeReference<>() {};

    private final StringRedisTemplate redisTemplate;
    private final HashOperations<String, String, String> hashOps;
    private final ObjectMapper objectMapper;

    public FishingSessionStore(StringRedisTemplate redisTemplate, ObjectMapper objectMapper) {
        this.redisTemplate = redisTemplate;
        this.hashOps = redisTemplate.opsForHash();
        this.objectMapper = objectMapper;
    }

    /**
     * 寫入（覆蓋）整個 Session 並重設 TTL——無版本檢查，僅供 {@code FishingService.start}
     * 建立全新 session 使用（該 key 前一刻不存在，無併發改寫可覆蓋）。
     * 既有 session 的讀改寫請一律改用 {@link #saveCas}。
     */
    public void save(FishingSession session) {
        String key = key(session.getPlayerId());
        hashOps.putAll(key, toHash(session));
        redisTemplate.expire(key, TTL);
    }

    /**
     * 樂觀鎖寫入：僅當 Redis 目前的 {@code version} 等於 {@code expectedVersion} 才整包覆寫
     * （成功時 {@code session.version} 會被設為 {@code expectedVersion + 1}，供呼叫端沿用同一物件）。
     * 失敗（版本不符，代表期間有其他寫入）回傳 false 且不動 Redis 內容——呼叫端應重讀最新
     * session、重放本次異動、再試（上限見 {@code FishingService} 的重試迴圈）。
     *
     * @return true=寫入成功；false=版本衝突（CAS 失敗，未落地）
     */
    public boolean saveCas(FishingSession session, long expectedVersion) {
        long newVersion = expectedVersion + 1;
        session.setVersion(newVersion);
        Map<String, String> hash = toHash(session);

        List<String> args = new ArrayList<>(2 + hash.size() * 2);
        args.add(String.valueOf(expectedVersion));
        args.add(String.valueOf(TTL.toMillis()));
        for (Map.Entry<String, String> entry : hash.entrySet()) {
            args.add(entry.getKey());
            args.add(entry.getValue());
        }

        Long result = redisTemplate.execute(SAVE_CAS_SCRIPT,
                List.of(key(session.getPlayerId())), args.toArray());
        boolean success = result != null && result == 1L;
        if (!success) {
            // CAS 失敗：還原記憶體內物件的 version，避免呼叫端誤把「期望值」當成已落地的新版本再往下用。
            session.setVersion(expectedVersion);
        }
        return success;
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

    private Map<String, String> toHash(FishingSession s) {
        Map<String, String> h = new HashMap<>();
        putIfNotNull(h, F_SESSION_ID, s.getSessionId());
        putIfNotNull(h, F_PLAYER_ID, s.getPlayerId());
        putIfNotNull(h, F_ROOM_ID, s.getRoomId());
        putIfNotNull(h, F_SEAT_INDEX, s.getSeatIndex());
        putIfNotNull(h, F_CANNON_LEVEL, s.getCannonLevel());
        putIfNotNull(h, F_BET_PER_SHOT, s.getBetPerShot());
        putIfNotNull(h, F_BUY_IN, s.getBuyIn());
        putIfNotNull(h, F_BALANCE_BEFORE, s.getBalanceBefore());
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
        putIfNotNull(h, F_INTERCEPTED, s.getIntercepted());
        // 血量/傷害模型的跨批狀態：以 JSON 持久化，缺了會讓每批重讀後累傷歸零（魚永遠打不死）。
        writeJson(h, F_FISH_DAMAGE, s.getFishDamage());
        writeJson(h, F_FISH_RECOVERY, s.getFishRecovery());
        writeJson(h, F_KILLS, s.getKills());
        writeJson(h, F_TOP_UP_REQUEST_IDS, s.getTopUpRequestIds());
        putIfNotNull(h, F_VERSION, s.getVersion());
        return h;
    }

    /** 把集合/物件序列化成 JSON 字串欄位；序列化失敗只記 warn 並略過該欄，不讓整筆 save 失敗。 */
    private void writeJson(Map<String, String> h, String field, Object value) {
        if (value == null) {
            return;
        }
        try {
            h.put(field, objectMapper.writeValueAsString(value));
        } catch (JsonProcessingException ex) {
            log.warn("序列化 fishing session 欄位 {} 失敗，略過: {}", field, ex.toString());
        }
    }

    private FishingSession fromHash(Map<String, String> h) {
        return FishingSession.builder()
                .sessionId(h.get(F_SESSION_ID))
                .playerId(parseLong(h.get(F_PLAYER_ID)))
                .roomId(h.get(F_ROOM_ID))
                .seatIndex(parseInt(h.get(F_SEAT_INDEX)))
                .cannonLevel(parseInt(h.get(F_CANNON_LEVEL)))
                .betPerShot(parseLong(h.get(F_BET_PER_SHOT)))
                .buyIn(parseLong(h.get(F_BUY_IN)))
                .balanceBefore(parseLong(h.get(F_BALANCE_BEFORE)))
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
                .intercepted(parseBoolean(h.get(F_INTERCEPTED)))
                .fishDamage(readFishDamage(h.get(F_FISH_DAMAGE)))
                .fishRecovery(readFishDamage(h.get(F_FISH_RECOVERY)))
                .kills(readKills(h.get(F_KILLS)))
                .topUpRequestIds(readTopUpRequestIds(h.get(F_TOP_UP_REQUEST_IDS)))
                .version(parseLong(h.get(F_VERSION)))
                .build();
    }

    /** 還原跨批累傷表；欄位缺失或 JSON 毀損時保守回空 Map（不讓整場崩潰）。 */
    private Map<String, Long> readFishDamage(String json) {
        if (!StringUtils.hasText(json)) {
            return new LinkedHashMap<>();
        }
        try {
            Map<String, Long> parsed = objectMapper.readValue(json, FISH_DAMAGE_TYPE);
            return parsed != null ? parsed : new LinkedHashMap<>();
        } catch (JsonProcessingException ex) {
            log.warn("反序列化 fishing fishDamage 失敗，改用空表: {}", ex.toString());
            return new LinkedHashMap<>();
        }
    }

    /** 還原場中加值 idempotency key 清單；欄位缺失或 JSON 毀損時保守回空 List。 */
    private List<String> readTopUpRequestIds(String json) {
        if (!StringUtils.hasText(json)) {
            return new ArrayList<>();
        }
        try {
            List<String> parsed = objectMapper.readValue(json, TOP_UP_IDS_TYPE);
            return parsed != null ? parsed : new ArrayList<>();
        } catch (JsonProcessingException ex) {
            log.warn("反序列化 fishing topUpRequestIds 失敗，改用空清單: {}", ex.toString());
            return new ArrayList<>();
        }
    }

    /** 還原致命一擊紀錄；欄位缺失或 JSON 毀損時保守回空 List。 */
    private List<FishingSession.KillRecord> readKills(String json) {
        if (!StringUtils.hasText(json)) {
            return new ArrayList<>();
        }
        try {
            List<FishingSession.KillRecord> parsed = objectMapper.readValue(json, KILLS_TYPE);
            return parsed != null ? parsed : new ArrayList<>();
        } catch (JsonProcessingException ex) {
            log.warn("反序列化 fishing kills 失敗，改用空清單: {}", ex.toString());
            return new ArrayList<>();
        }
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

    private static Boolean parseBoolean(String v) {
        return StringUtils.hasText(v) ? Boolean.valueOf(v) : null;
    }
}
