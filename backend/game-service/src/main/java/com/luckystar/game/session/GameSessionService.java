package com.luckystar.game.session;

import java.time.Duration;
import java.time.Instant;
import java.util.HashMap;
import java.util.Map;
import java.util.Optional;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.redis.core.HashOperations;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

/**
 * 遊戲 Session 管理（T-033）。以 Redis 暫存每一局的局內狀態，支撐 Provably Fair 的
 * commit-reveal 流程：開局時先承諾 {@code serverSeedHash}（{@link GameSessionState#STARTED}），
 * 結算後揭露 {@code serverSeed}（{@link GameSessionState#SETTLED}），玩家可在 TTL 內取回驗證。
 *
 * <p><b>儲存格式</b>：依 architecture.md §6，Key 為 {@code game:session:{playerId}:{roundId}}，
 * 型別為 <b>Hash</b>（每個欄位一個 hash field），TTL 30 分鐘（逾時自動清除，符合「對局短時效」語意）。
 * 以 {@link StringRedisTemplate} 的 {@code opsForHash} 存取，欄位在 redis-cli 可直接讀、
 * 並支援結算時只更新 {@code state}/{@code serverSeed} 等少數欄位而不重寫整筆。
 *
 * <p><b>注意</b>：本服務只負責 Session 的存取與狀態轉移，不參與帳務；帳務一致性仍由
 * {@code SlotService} 的冪等扣款/派彩負責。
 */
@Slf4j
@Service
public class GameSessionService {

    /** Redis Key 前綴：{@code game:session:{playerId}:{roundId}}。 */
    private static final String KEY_PREFIX = "game:session:";

    // ---- Hash 欄位名 ----
    private static final String F_ROUND_ID = "roundId";
    private static final String F_PLAYER_ID = "playerId";
    private static final String F_GAME_TYPE = "gameType";
    private static final String F_BET_AMOUNT = "betAmount";
    private static final String F_BALANCE_BEFORE = "balanceBefore";
    private static final String F_BET_PLAYER = "betPlayer";
    private static final String F_BET_BANKER = "betBanker";
    private static final String F_BET_TIE = "betTie";
    private static final String F_SERVER_SEED = "serverSeed";
    private static final String F_SERVER_SEED_HASH = "serverSeedHash";
    private static final String F_CLIENT_SEED = "clientSeed";
    private static final String F_NONCE = "nonce";
    private static final String F_STATE = "state";
    private static final String F_CREATED_AT = "createdAt";

    /** 對局 Session 存活時間，預設 30 分鐘（可由設定 {@code game.session.ttl} 覆寫）。 */
    private final Duration ttl;

    private final StringRedisTemplate redisTemplate;
    private final HashOperations<String, String, String> hashOps;

    public GameSessionService(StringRedisTemplate redisTemplate,
                              @Value("${game.session.ttl:PT30M}") Duration ttl) {
        this.redisTemplate = redisTemplate;
        this.hashOps = redisTemplate.opsForHash();
        this.ttl = ttl;
    }

    /**
     * 開局：建立 Session（狀態強制為 {@link GameSessionState#STARTED}）並寫入 Redis Hash，套用 30 分鐘 TTL。
     * 若未帶 {@code createdAt} 則填入當下時間。
     *
     * @param session 至少需含 playerId 與 roundId
     * @return 實際寫入的 Session（含補齊的 state / createdAt）
     */
    public GameSession start(GameSession session) {
        requireKeyFields(session.getPlayerId(), session.getRoundId());
        session.setState(GameSessionState.STARTED);
        if (session.getCreatedAt() == null) {
            session.setCreatedAt(Instant.now());
        }
        String key = key(session.getPlayerId(), session.getRoundId());
        hashOps.putAll(key, toHash(session));
        redisTemplate.expire(key, ttl);
        log.debug("game session started playerId={} roundId={}", session.getPlayerId(), session.getRoundId());
        return session;
    }

    /**
     * 取得指定玩家某局的 Session。
     *
     * @return 命中且可解析時回傳 Session；不存在/已逾時/資料毀損則回 {@link Optional#empty()}
     */
    public Optional<GameSession> find(long playerId, String roundId) {
        String key = key(playerId, roundId);
        Map<String, String> hash = hashOps.entries(key);
        if (hash == null || hash.isEmpty()) {
            return Optional.empty();
        }
        try {
            return Optional.of(fromHash(hash));
        } catch (RuntimeException ex) {
            // 資料毀損不應讓呼叫端崩潰；視同不存在並記錄。
            log.warn("解析 game session 失敗 playerId={} roundId={}: {}", playerId, roundId, ex.toString());
            return Optional.empty();
        }
    }

    /**
     * 結算：把 Session 轉為 {@link GameSessionState#SETTLED}，可一併補上揭露用的 serverSeed
     * 與最終 nonce，並重新套用 TTL（保留 30 分鐘驗證視窗）。僅更新異動欄位，不重寫整筆。
     *
     * @param serverSeed 結算時揭露的 server seed（可為 null 表示沿用既有值）
     * @param nonce      本局最終 nonce（可為 null 表示沿用既有值）
     * @return 更新後的 Session；若 Session 不存在（已逾時/未開局）則回 {@link Optional#empty()}
     */
    public Optional<GameSession> markSettled(long playerId, String roundId, String serverSeed, Long nonce) {
        String key = key(playerId, roundId);
        if (!Boolean.TRUE.equals(redisTemplate.hasKey(key))) {
            log.warn("結算找不到 game session（可能已逾時）playerId={} roundId={}", playerId, roundId);
            return Optional.empty();
        }
        Map<String, String> updates = new HashMap<>();
        updates.put(F_STATE, GameSessionState.SETTLED.name());
        if (serverSeed != null) {
            updates.put(F_SERVER_SEED, serverSeed);
        }
        if (nonce != null) {
            updates.put(F_NONCE, Long.toString(nonce));
        }
        hashOps.putAll(key, updates);
        redisTemplate.expire(key, ttl);
        log.debug("game session settled playerId={} roundId={}", playerId, roundId);
        return find(playerId, roundId);
    }

    /**
     * 刪除 Session（例如取消、或結算後主動清理）。
     *
     * @return true 表示確實刪除了一筆
     */
    public boolean delete(long playerId, String roundId) {
        return Boolean.TRUE.equals(redisTemplate.delete(key(playerId, roundId)));
    }

    /** 建構 Redis Key：{@code game:session:{playerId}:{roundId}}。 */
    String key(long playerId, String roundId) {
        return KEY_PREFIX + playerId + ":" + roundId;
    }

    // ----------------------------------------------------------------------
    // Hash <-> GameSession 轉換（所有值以字串存放；null 欄位略過不寫）
    // ----------------------------------------------------------------------

    private static Map<String, String> toHash(GameSession s) {
        Map<String, String> h = new HashMap<>();
        putIfNotNull(h, F_ROUND_ID, s.getRoundId());
        putIfNotNull(h, F_PLAYER_ID, s.getPlayerId());
        putIfNotNull(h, F_GAME_TYPE, s.getGameType());
        putIfNotNull(h, F_BET_AMOUNT, s.getBetAmount());
        putIfNotNull(h, F_BALANCE_BEFORE, s.getBalanceBefore());
        putIfNotNull(h, F_BET_PLAYER, s.getBetPlayer());
        putIfNotNull(h, F_BET_BANKER, s.getBetBanker());
        putIfNotNull(h, F_BET_TIE, s.getBetTie());
        putIfNotNull(h, F_SERVER_SEED, s.getServerSeed());
        putIfNotNull(h, F_SERVER_SEED_HASH, s.getServerSeedHash());
        putIfNotNull(h, F_CLIENT_SEED, s.getClientSeed());
        putIfNotNull(h, F_NONCE, s.getNonce());
        if (s.getState() != null) {
            h.put(F_STATE, s.getState().name());
        }
        if (s.getCreatedAt() != null) {
            h.put(F_CREATED_AT, s.getCreatedAt().toString());
        }
        return h;
    }

    private static GameSession fromHash(Map<String, String> h) {
        return GameSession.builder()
                .roundId(h.get(F_ROUND_ID))
                .playerId(parseLong(h.get(F_PLAYER_ID)))
                .gameType(h.get(F_GAME_TYPE))
                .betAmount(parseLong(h.get(F_BET_AMOUNT)))
                .balanceBefore(parseLong(h.get(F_BALANCE_BEFORE)))
                .betPlayer(parseLong(h.get(F_BET_PLAYER)))
                .betBanker(parseLong(h.get(F_BET_BANKER)))
                .betTie(parseLong(h.get(F_BET_TIE)))
                .serverSeed(h.get(F_SERVER_SEED))
                .serverSeedHash(h.get(F_SERVER_SEED_HASH))
                .clientSeed(h.get(F_CLIENT_SEED))
                .nonce(parseLong(h.get(F_NONCE)))
                .state(parseState(h.get(F_STATE)))
                .createdAt(parseInstant(h.get(F_CREATED_AT)))
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

    private static Instant parseInstant(String v) {
        return StringUtils.hasText(v) ? Instant.parse(v) : null;
    }

    private static GameSessionState parseState(String v) {
        return StringUtils.hasText(v) ? GameSessionState.valueOf(v) : null;
    }

    private static void requireKeyFields(Long playerId, String roundId) {
        if (playerId == null || roundId == null || roundId.isBlank()) {
            throw new IllegalArgumentException("game session 需提供 playerId 與 roundId");
        }
    }
}
