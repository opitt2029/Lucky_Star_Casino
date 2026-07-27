package com.luckystar.wallet.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.luckystar.wallet.postgres.entity.WalletOutbox;
import com.luckystar.wallet.postgres.repository.WalletOutboxRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

/**
 * 把要送出的 Kafka 事件寫進 wallet_outbox 表（狀態 PENDING）——藍圖 04 P2。
 *
 * <p>刻意「不」標 {@code @Transactional}：沿用呼叫端的交易（Propagation.REQUIRED 預設行為），
 * 讓「帳務資料寫入」與「事件寫入」落在同一個 Postgres 交易裡——這正是 Outbox 的核心。
 * 因此呼叫端（{@link WalletService#credit}/{@link WalletService#debit}、
 * {@link GiftTransferService#transfer}）必須是 {@code @Transactional(postgresTransactionManager)}
 * 方法，否則就失去原子性保證。
 *
 * <p><b>序列化留在交易內</b>：{@link JsonProcessingException} 往上拋讓整筆交易 rollback，
 * 而非吞掉——序列化失敗代表事件永遠發不出去，此時讓帳務也失敗，比留下一個無聲缺口好
 * （藍圖 04 P2 施工 §3）。實務上事件都是簡單 record，序列化失敗幾乎只可能是程式錯誤。
 */
@Service
@RequiredArgsConstructor
public class WalletOutboxService {

    private final WalletOutboxRepository walletOutboxRepository;
    private final ObjectMapper objectMapper;

    public void save(String topic, String key, Object payload) {
        try {
            WalletOutbox event = new WalletOutbox();
            event.setTopic(topic);
            event.setKafkaKey(key);
            event.setPayload(objectMapper.writeValueAsString(payload));
            walletOutboxRepository.save(event);
        } catch (JsonProcessingException e) {
            // 序列化失敗屬程式錯誤，往上拋讓整個交易回滾（不可留無聲缺口）
            throw new IllegalStateException("Failed to serialize wallet outbox payload for topic " + topic, e);
        }
    }
}
