package com.luckystar.admin.service;

import com.luckystar.admin.kafka.GameResultEvent;
import com.luckystar.admin.kafka.NotificationPushPublisher;
import com.luckystar.admin.kafka.WalletEvent;
import com.luckystar.admin.postgres.entity.AdminAlert;
import com.luckystar.admin.postgres.repository.AdminAlertRepository;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 異常玩家偵測規則引擎（T-054）。
 *
 * 三條規則：
 * <ol>
 *   <li><b>BIG_WIN</b>：單局中獎金額 &gt; 50,000。</li>
 *   <li><b>HIGH_FREQUENCY</b>：30 分鐘內下注 &gt; 100 次（Redis 滑動計數）。</li>
 *   <li><b>ABNORMAL_TRANSFER</b>：60 秒內帳務異動 &gt; 20 次（Redis 滑動計數）。</li>
 * </ol>
 * 命中即落庫 {@code admin_alerts} 並 best-effort 發 {@code notification.push} 廣播給後台。
 */
@Service
public class AlertRuleEngine {

    static final long BIG_WIN_THRESHOLD = 50_000L;

    static final int HIGH_FREQ_BET_LIMIT = 100;
    static final Duration HIGH_FREQ_WINDOW = Duration.ofMinutes(30);
    static final String BETCOUNT_KEY_PREFIX = "admin:betcount:";

    static final int ABNORMAL_TXN_LIMIT = 20;
    static final Duration ABNORMAL_TXN_WINDOW = Duration.ofSeconds(60);
    static final String TXNCOUNT_KEY_PREFIX = "admin:txncount:";

    static final String ALERT_BIG_WIN = "BIG_WIN";
    static final String ALERT_HIGH_FREQUENCY = "HIGH_FREQUENCY";
    static final String ALERT_ABNORMAL_TRANSFER = "ABNORMAL_TRANSFER";

    private static final Logger log = LoggerFactory.getLogger(AlertRuleEngine.class);

    private final AdminAlertRepository alertRepository;
    private final StringRedisTemplate redisTemplate;
    private final NotificationPushPublisher notificationPushPublisher;

    public AlertRuleEngine(
            AdminAlertRepository alertRepository,
            StringRedisTemplate redisTemplate,
            NotificationPushPublisher notificationPushPublisher) {
        this.alertRepository = alertRepository;
        this.redisTemplate = redisTemplate;
        this.notificationPushPublisher = notificationPushPublisher;
    }

    /** 規則 ①大額中獎 + ②高頻下注（每筆遊戲結算各算一次下注）。 */
    @Transactional("postgresTransactionManager")
    public void onGameResult(GameResultEvent event) {
        if (event == null || event.playerId() == null) {
            return;
        }
        Long playerId = event.playerId();

        Long payout = event.payout();
        if (payout != null && payout > BIG_WIN_THRESHOLD) {
            raise(playerId, ALERT_BIG_WIN,
                    "single-round payout " + payout + " > " + BIG_WIN_THRESHOLD);
        }

        long betCount = incrWithTtl(BETCOUNT_KEY_PREFIX + playerId, HIGH_FREQ_WINDOW);
        if (betCount > HIGH_FREQ_BET_LIMIT) {
            raise(playerId, ALERT_HIGH_FREQUENCY,
                    "bet count " + betCount + " > " + HIGH_FREQ_BET_LIMIT
                            + " within " + HIGH_FREQ_WINDOW.toMinutes() + "min");
        }
    }

    /** 規則 ③帳務異動頻率異常。 */
    @Transactional("postgresTransactionManager")
    public void onWalletEvent(WalletEvent event) {
        if (event == null || event.playerId() == null) {
            return;
        }
        Long playerId = event.playerId();

        long txnCount = incrWithTtl(TXNCOUNT_KEY_PREFIX + playerId, ABNORMAL_TXN_WINDOW);
        if (txnCount > ABNORMAL_TXN_LIMIT) {
            raise(playerId, ALERT_ABNORMAL_TRANSFER,
                    "transaction count " + txnCount + " > " + ABNORMAL_TXN_LIMIT
                            + " within " + ABNORMAL_TXN_WINDOW.toSeconds() + "s");
        }
    }

    /**
     * Redis 計數器自增；首次（值為 1）設 TTL，達到視窗即自動歸零，形成滑動計數窗。
     * Redis 不可用時回 0（不丟例外、不誤觸告警）。
     */
    private long incrWithTtl(String key, Duration ttl) {
        Long value = redisTemplate.opsForValue().increment(key);
        if (value == null) {
            return 0L;
        }
        if (value == 1L) {
            redisTemplate.expire(key, ttl);
        }
        return value;
    }

    void raise(Long playerId, String alertType, String detail) {
        alertRepository.save(new AdminAlert(playerId, alertType, detail));
        log.info("Anomaly alert raised: player={} type={} detail={}", playerId, alertType, detail);

        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("playerId", playerId);
        payload.put("alertType", alertType);
        payload.put("detail", detail);
        // 廣播給後台（targetPlayerId=null）；best-effort，發送失敗不影響告警落庫。
        notificationPushPublisher.publishAlert(
                null,
                alertType,
                "Anomaly detected: " + alertType,
                "Player " + playerId + " — " + detail,
                payload);
    }
}
