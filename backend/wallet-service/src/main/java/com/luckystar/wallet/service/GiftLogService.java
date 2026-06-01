package com.luckystar.wallet.service;

import com.luckystar.wallet.mysql.entity.GiftLog;
import com.luckystar.wallet.mysql.repository.GiftLogRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;

/**
 * 好友贈幣稽核紀錄寫入（T-026）。寫的是 MySQL 讀庫的 {@code gift_logs}，因此走
 * {@code mysqlTransactionManager}（不是 @Primary 的 postgres）。
 *
 * <p>由 {@link GiftService} 在 PostgreSQL 轉帳 commit「之後」呼叫，屬 best-effort：失敗時
 * {@link GiftService} 只記 WARN、不回滾金流（已知限制：稽核列可能少於實際轉帳列）。
 * 獨立成 bean 是為了讓指定 mysql 交易管理器的 {@code @Transactional} proxy 生效。
 */
@Service
@RequiredArgsConstructor
public class GiftLogService {

    private final GiftLogRepository giftLogRepository;

    @Transactional(transactionManager = "mysqlTransactionManager")
    public void record(Long senderId, Long receiverId, long amount) {
        giftLogRepository.save(GiftLog.builder()
                .senderId(senderId)
                .receiverId(receiverId)
                .amount(amount)
                .createdAt(LocalDateTime.now())
                .build());
    }
}
