package com.luckystar.rank.kafka;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.luckystar.rank.service.RankService;
import java.time.Duration;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.kafka.support.Acknowledgment;
import org.springframework.stereotype.Component;

@Component
public class WalletBalanceChangedConsumer {

    private static final Logger log = LoggerFactory.getLogger(WalletBalanceChangedConsumer.class);

    /**
     * 日贏分去重鍵前綴：帶用途前綴，未來其他去重點不撞。
     * key = {@code rank:dedup:daily-win:{transactionId}}。
     */
    private static final String DEDUP_KEY_PREFIX = "rank:dedup:daily-win:";

    /**
     * 去重鍵存活時間：對齊 {@link RankService#DAILY_WINNINGS_KEY} 自身的 48h TTL，
     * 且必須 > 最大重送窗口（consumer lag + FixedBackOff 重試 + DLT 人工重放）。
     */
    private static final Duration DEDUP_TTL = Duration.ofHours(48);

    private final RankService rankService;
    private final ObjectMapper objectMapper;
    private final StringRedisTemplate redisTemplate;

    public WalletBalanceChangedConsumer(
            RankService rankService, ObjectMapper objectMapper, StringRedisTemplate redisTemplate) {
        this.rankService = rankService;
        this.objectMapper = objectMapper;
        this.redisTemplate = redisTemplate;
    }

    @KafkaListener(
            topics = {"wallet.credit", "wallet.debit"},
            groupId = "${spring.kafka.consumer.group-id:rank-service-group}",
            autoStartup = "${spring.kafka.listener.auto-startup:true}")
    public void handleWalletBalanceChanged(String message, Acknowledgment ack) throws Exception {
        WalletBalanceChangedEvent event = objectMapper.readValue(message, WalletBalanceChangedEvent.class);
        validate(event);

        // updatePlayerCoins 用 ZADD 寫入絕對值 balanceAfter，冪等、重送無害——不去重。
        rankService.updatePlayerCoins(event.playerId(), event.balanceAfter());

        // addDailyWinnings 用 ZINCRBY 累加，不冪等——只有這一支需要去重擋重送。
        if ("WIN".equals(event.subType()) && event.amount() != null) {
            if (shouldAccumulateDailyWinnings(event)) {
                rankService.addDailyWinnings(event.playerId(), event.amount());
            }
        }
        ack.acknowledge();

        log.info(
                "Updated global coins rank for playerId={}, transactionId={}, balanceAfter={}",
                event.playerId(),
                event.transactionId(),
                event.balanceAfter());
    }

    /**
     * 以 {@code transactionId} 為去重鍵做 Redis SETNX：回傳「我是不是第一個消費者」。
     *
     * <p>best-effort 去重（非 exactly-once）：SETNX 成功後、ZINCRBY 執行前崩潰會永久漏計一筆，
     * 但漏計（排行榜些微偏低）的傷害遠小於重複累加（虛增、可被刷）。若日後日贏分接入實際獎勵
     * 發放，須升級為「SETNX + ZINCRBY」單一 Lua script 的原子版（比照 ADR-008 CAS）。
     *
     * <p>{@code transactionId} 為 null 時**跳過去重直接執行**（退回現狀）並 warn：
     * 若用 null 組 key，所有事件會共用同一把鍵，第一筆之後全被吃掉。
     */
    private boolean shouldAccumulateDailyWinnings(WalletBalanceChangedEvent event) {
        if (event.transactionId() == null) {
            log.warn(
                    "wallet balance event missing transactionId; skipping dedup and accumulating daily "
                            + "winnings directly for playerId={}",
                    event.playerId());
            return true;
        }

        Boolean first = redisTemplate.opsForValue()
                .setIfAbsent(DEDUP_KEY_PREFIX + event.transactionId(), "1", DEDUP_TTL);
        if (Boolean.TRUE.equals(first)) {
            return true;
        }

        log.info(
                "duplicate wallet.credit WIN event ignored for daily winnings; transactionId={}, playerId={}",
                event.transactionId(),
                event.playerId());
        return false;
    }

    private void validate(WalletBalanceChangedEvent event) {
        if (event.playerId() == null) {
            throw new IllegalArgumentException("playerId is required");
        }
        if (event.balanceAfter() == null) {
            throw new IllegalArgumentException("balanceAfter is required");
        }
    }
}
