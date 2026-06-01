package com.luckystar.wallet.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.luckystar.wallet.dto.GiftRequest;
import com.luckystar.wallet.dto.GiftResponse;
import com.luckystar.wallet.exception.GiftLimitExceededException;
import com.luckystar.wallet.exception.InvalidGiftException;
import com.luckystar.wallet.kafka.WalletCreditEvent;
import com.luckystar.wallet.kafka.WalletDebitEvent;
import com.luckystar.wallet.postgres.entity.WalletTransaction;
import com.luckystar.wallet.postgres.repository.WalletTransactionRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.stereotype.Service;

import java.time.LocalDate;
import java.time.ZoneId;

/**
 * 好友星幣贈送協調器（T-026）。對應 {@code POST /api/v1/wallet/gift}。
 *
 * <p>把「轉帳前後」的非交易步驟串起來，金流真相（雙向分錄）委派給 {@link GiftTransferService}：
 * <ol>
 *   <li><b>基本驗證</b>：不可贈送給自己（{@link InvalidGiftException} → 400）。金額為正、欄位非空由 DTO 驗證。</li>
 *   <li><b>冪等預檢</b>：用贈送方分錄的 idempotencyKey 查流水，已存在就直接回原結果、<b>完全不碰 Redis</b>
 *       （確保重送不會灌爆當日額度）。</li>
 *   <li><b>Redis 當日額度預扣</b>：贈出（{@value #DAILY_SENT_LIMIT}）與收受（{@value #DAILY_RECV_LIMIT}）上限，
 *       INCRBY 後若任一超限則 DECRBY 回補並丟 {@link GiftLimitExceededException} → 422。鍵 TTL 到當地午夜。</li>
 *   <li><b>原子轉帳</b>：{@link GiftTransferService#transfer}（單一 PostgreSQL 交易，雙向分錄）。
 *       任何例外都會回補 Redis 預扣再往外拋。</li>
 *   <li><b>best-effort 下游</b>：寫 gift_logs（MySQL 稽核）、發 wallet.debit / wallet.credit 兩個事件。
 *       失敗只記 WARN，不影響已 commit 的金流（已知限制，見類別尾註）。</li>
 * </ol>
 *
 * <h3>已知限制（刻意放棄跨資料源原子性，<b>不</b>引入 XA/JTA）</h3>
 * <ul>
 *   <li>PostgreSQL 雙分錄是唯一金流真相；commit 之後的 gift_logs / Kafka 皆 best-effort。</li>
 *   <li>gift_logs 可能少列（稽核缺口，非餘額錯誤）；Kafka 事件可能掉（rank-service 落後到下次重算）。</li>
 *   <li>Redis 預扣只在「JVM 在 INCRBY 後、轉帳 commit 前被硬殺」時可能多計；多計只會讓額度更嚴格、
 *       不會讓玩家超額，且當日午夜 TTL 到期自動歸零。</li>
 * </ul>
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class GiftService {

    /** 每位玩家每日「贈出」上限（星幣）。超過則拒絕。 */
    static final long DAILY_SENT_LIMIT = 5_000L;

    /** 每位玩家每日「收受」上限（星幣）。超過則拒絕。 */
    static final long DAILY_RECV_LIMIT = 10_000L;

    /** 當日累計以當地（台北）日界為準，TTL 重置在當地午夜。 */
    private static final ZoneId ZONE = ZoneId.of("Asia/Taipei");

    private final GiftTransferService giftTransferService;
    private final GiftLogService giftLogService;
    private final WalletTransactionRepository walletTransactionRepository;
    private final StringRedisTemplate redisTemplate;
    private final KafkaTemplate<String, String> kafkaTemplate;
    private final ObjectMapper objectMapper;

    public GiftResponse gift(Long senderId, GiftRequest request) {
        Long receiverId = request.getReceiverId();
        long amount = request.getAmount();

        // Step 1: 基本驗證 —— 不可贈送給自己
        if (senderId.equals(receiverId)) {
            throw new InvalidGiftException("Cannot gift to yourself");
        }

        String debitKey = request.getIdempotencyKey() + ":gift:debit";
        String creditKey = request.getIdempotencyKey() + ":gift:credit";

        // Step 2: 冪等預檢 —— 已贈送過就回原結果，完全不碰 Redis（避免重送灌爆當日額度）
        var existingDebit = walletTransactionRepository.findByIdempotencyKey(debitKey);
        if (existingDebit.isPresent()) {
            return buildIdempotentResponse(existingDebit.get(), creditKey);
        }

        // Step 3: Redis 當日額度預扣（INCRBY 後檢查，超限即回補並拒絕）
        String date = LocalDate.now(ZONE).toString();
        String sentKey = "wallet:gift:sent:" + senderId + ":" + date;
        String recvKey = "wallet:gift:recv:" + receiverId + ":" + date;
        reserveDailyQuota(sentKey, recvKey, amount);

        // Step 4: 原子轉帳；任何失敗都回補 Redis 預扣
        GiftTransferService.Result result;
        try {
            result = giftTransferService.transfer(senderId, receiverId, amount, debitKey, creditKey);
        } catch (DataIntegrityViolationException dup) {
            // 並發同 key 重入：DB UNIQUE 擋下、整筆交易已回滾 → 回補本次預扣，並以冪等命中回應贏家紀錄
            releaseDailyQuota(sentKey, recvKey, amount);
            return walletTransactionRepository.findByIdempotencyKey(debitKey)
                    .map(winner -> buildIdempotentResponse(winner, creditKey))
                    .orElseThrow(() -> dup); // 理論上不會發生：約束觸發卻查不到紀錄
        } catch (RuntimeException e) {
            // 餘額不足 / 錢包不存在 / 樂觀鎖衝突 ... 一律回補預扣後原樣往外拋
            releaseDailyQuota(sentKey, recvKey, amount);
            throw e;
        }

        WalletTransaction debit = result.debit();
        WalletTransaction credit = result.credit();

        // Step 5: best-effort 下游（轉帳已 commit，下列失敗不回滾金流）
        // TODO(T-026): consider Outbox for gift_logs/Kafka eventual consistency
        try {
            giftLogService.record(senderId, receiverId, amount);
        } catch (Exception e) {
            log.warn("Failed to write gift_logs audit row: senderId={} receiverId={} amount={}",
                    senderId, receiverId, amount, e);
        }
        publishEvent("wallet.debit", String.valueOf(senderId), new WalletDebitEvent(
                debit.getId(), senderId, amount,
                debit.getBalanceBefore(), debit.getBalanceAfter(),
                "GIFT", debitKey, debit.getReferenceId()));
        publishEvent("wallet.credit", String.valueOf(receiverId), new WalletCreditEvent(
                credit.getId(), receiverId, amount,
                credit.getBalanceBefore(), credit.getBalanceAfter(),
                "GIFT", creditKey, credit.getReferenceId()));

        return GiftResponse.builder()
                .senderId(senderId)
                .receiverId(receiverId)
                .amount(amount)
                .debitTransactionId(debit.getId())
                .creditTransactionId(credit.getId())
                .senderBalanceAfter(debit.getBalanceAfter())
                .receiverBalanceAfter(credit.getBalanceAfter())
                .idempotent(false)
                .build();
    }

    /**
     * INCRBY 預扣贈出/收受當日累計，超限則 DECRBY 回補並拒絕。鍵首次建立時設 TTL 到當地午夜。
     */
    private void reserveDailyQuota(String sentKey, String recvKey, long amount) {
        Long sentTotal = redisTemplate.opsForValue().increment(sentKey, amount);
        ensureMidnightExpiry(sentKey);
        Long recvTotal = redisTemplate.opsForValue().increment(recvKey, amount);
        ensureMidnightExpiry(recvKey);

        boolean sentExceeded = sentTotal != null && sentTotal > DAILY_SENT_LIMIT;
        boolean recvExceeded = recvTotal != null && recvTotal > DAILY_RECV_LIMIT;
        if (sentExceeded || recvExceeded) {
            releaseDailyQuota(sentKey, recvKey, amount);
            if (sentExceeded) {
                throw new GiftLimitExceededException(
                        "Daily gift-sent limit exceeded (limit " + DAILY_SENT_LIMIT + ")");
            }
            throw new GiftLimitExceededException(
                    "Receiver daily gift-received limit exceeded (limit " + DAILY_RECV_LIMIT + ")");
        }
    }

    /** 回補（DECRBY）預扣量。轉帳失敗或超限時呼叫。 */
    private void releaseDailyQuota(String sentKey, String recvKey, long amount) {
        try {
            redisTemplate.opsForValue().decrement(sentKey, amount);
            redisTemplate.opsForValue().decrement(recvKey, amount);
        } catch (Exception e) {
            // 回補失敗只記 WARN：多計只會讓額度更嚴格、不會讓玩家超額，且午夜 TTL 到期自動歸零
            log.warn("Failed to release reserved daily gift quota: sentKey={} recvKey={} amount={}",
                    sentKey, recvKey, amount, e);
        }
    }

    /** 只在尚未設過 TTL 時，把鍵的到期時間設為當地下一個午夜。 */
    private void ensureMidnightExpiry(String key) {
        Long ttl = redisTemplate.getExpire(key);
        if (ttl != null && ttl == -1L) {
            var nextMidnight = LocalDate.now(ZONE).plusDays(1).atStartOfDay(ZONE).toInstant();
            redisTemplate.expireAt(key, nextMidnight);
        }
    }

    private void publishEvent(String topic, String key, Object event) {
        try {
            kafkaTemplate.send(topic, key, objectMapper.writeValueAsString(event));
        } catch (Exception e) {
            log.warn("Failed to publish {} event for key={}", topic, key, e);
        }
    }

    private GiftResponse buildIdempotentResponse(WalletTransaction debit, String creditKey) {
        // 入帳分錄理應與出帳分錄同筆交易一起寫入，故通常存在；防禦性處理其缺漏。
        WalletTransaction credit = walletTransactionRepository.findByIdempotencyKey(creditKey).orElse(null);
        return GiftResponse.builder()
                .senderId(debit.getPlayerId())
                .receiverId(credit == null ? null : credit.getPlayerId())
                .amount(debit.getAmount())
                .debitTransactionId(debit.getId())
                .creditTransactionId(credit == null ? null : credit.getId())
                .senderBalanceAfter(debit.getBalanceAfter())
                .receiverBalanceAfter(credit == null ? null : credit.getBalanceAfter())
                .idempotent(true)
                .build();
    }
}
