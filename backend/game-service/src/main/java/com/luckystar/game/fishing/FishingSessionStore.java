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
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;

/**
 * ??璈?Session ??Redis 摮?撅扎ey嚗@code game:fishing:session:{playerId}}嚗ash嚗?
 * 瘥??拙振???憭??脰?銝剖甈～?
 *
 * <p>TTL ??24 撠?雿摰蝬聆祕???嗥 {@link FishingService} ??蝵格?蝔
 * ?蔭 10 ???蜓??蝞??擗??折?憿???wallet嚗?TTL ?芷???瑟?憭望???Redis ????
 * 瘥 {@code GameSessionService} ??Hash ?脣?憸冽??
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
    private static final String F_GUARANTEED_SHOT_SEQ = "guaranteedShotSeq";
    private static final String F_FISH_DAMAGE = "fishDamage";
    private static final String F_KILLS = "kills";
    private static final String F_TOP_UP_REQUEST_IDS = "topUpRequestIds";

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

    /** 撖怠嚗????游?Session 銝阡?閮?TTL??*/
    public void save(FishingSession session) {
        String key = key(session.getPlayerId());
        hashOps.putAll(key, toHash(session));
        redisTemplate.expire(key, TTL);
    }

    /** ???拙振?桀???擳?Session嚗?摮/瘥??蝛綽???*/
    public Optional<FishingSession> find(long playerId) {
        Map<String, String> hash = hashOps.entries(key(playerId));
        if (hash == null || hash.isEmpty()) {
            return Optional.empty();
        }
        try {
            return Optional.of(fromHash(hash));
        } catch (RuntimeException ex) {
            log.warn("閫?? fishing session 憭望? playerId={}: {}", playerId, ex.toString());
            return Optional.empty();
        }
    }

    public boolean delete(long playerId) {
        return Boolean.TRUE.equals(redisTemplate.delete(key(playerId)));
    }

    /**
     * ????擳?Session ?摰?ID嚗?蝵桀??嗆?蝔嚗?
     *
     * <p>隞?{@code SCAN} 皜豢????嚗??餃?嚗??踹? {@code KEYS} ??key ?之?憛??Redis??
     * 瘥??拙振?憭???key嚗?????函??湔活皜??
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
                    // ???撘? key嚗歲??
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
        putIfNotNull(h, F_GUARANTEED_SHOT_SEQ, s.getGuaranteedShotSeq());
        // 銵???瑕拿璅∪??楊?寧???隞?JSON ????蝻箔???瘥??敺敞?瑟飛?塚?擳偶??銝香嚗?
        writeJson(h, F_FISH_DAMAGE, s.getFishDamage());
        writeJson(h, F_KILLS, s.getKills());
        writeJson(h, F_TOP_UP_REQUEST_IDS, s.getTopUpRequestIds());
        return h;
    }

    /** ?????拐辣摨??? JSON 摮葡甈?嚗???憭望??芾? warn 銝衣?府甈?銝??渡? save 憭望???*/
    private void writeJson(Map<String, String> h, String field, Object value) {
        if (value == null) {
            return;
        }
        try {
            h.put(field, objectMapper.writeValueAsString(value));
        } catch (JsonProcessingException ex) {
            log.warn("摨???fishing session 甈? {} 憭望?嚗?? {}", field, ex.toString());
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
                .guaranteedShotSeq(parseLong(h.get(F_GUARANTEED_SHOT_SEQ)))
                .fishDamage(readFishDamage(h.get(F_FISH_DAMAGE)))
                .kills(readKills(h.get(F_KILLS)))
                .topUpRequestIds(readTopUpRequestIds(h.get(F_TOP_UP_REQUEST_IDS)))
                .build();
    }

    /** ??頝冽蝝臬銵剁?甈?蝻箏仃??JSON 瘥??靽??征 Map嚗?霈?游援瞏堆???*/
    private Map<String, Long> readFishDamage(String json) {
        if (!StringUtils.hasText(json)) {
            return new LinkedHashMap<>();
        }
        try {
            Map<String, Long> parsed = objectMapper.readValue(json, FISH_DAMAGE_TYPE);
            return parsed != null ? parsed : new LinkedHashMap<>();
        } catch (JsonProcessingException ex) {
            log.warn("???? fishing fishDamage 憭望?嚗?函征銵? {}", ex.toString());
            return new LinkedHashMap<>();
        }
    }

    /** ???游銝????甈?蝻箏仃??JSON 瘥??靽??征 List??*/
    private List<String> readTopUpRequestIds(String json) {
        if (!StringUtils.hasText(json)) {
            return new ArrayList<>();
        }
        try {
            List<String> parsed = objectMapper.readValue(json, TOP_UP_IDS_TYPE);
            return parsed != null ? parsed : new ArrayList<>();
        } catch (JsonProcessingException ex) {
            log.warn("Failed to read fishing topUpRequestIds: {}", ex.toString());
            return new ArrayList<>();
        }
    }

    private List<FishingSession.KillRecord> readKills(String json) {
        if (!StringUtils.hasText(json)) {
            return new ArrayList<>();
        }
        try {
            List<FishingSession.KillRecord> parsed = objectMapper.readValue(json, KILLS_TYPE);
            return parsed != null ? parsed : new ArrayList<>();
        } catch (JsonProcessingException ex) {
            log.warn("???? fishing kills 憭望?嚗?函征皜: {}", ex.toString());
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
