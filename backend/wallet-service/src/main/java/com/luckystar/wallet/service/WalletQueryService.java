package com.luckystar.wallet.service;

import com.luckystar.wallet.common.PagedResponse;
import com.luckystar.wallet.dto.WalletTransactionResponse;
import com.luckystar.wallet.mysql.repository.WalletTransactionViewRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;

/**
 * 帳務流水查詢服務（T-025，CQRS 讀端）。
 *
 * <p>固定走 MySQL 讀庫（{@code mysqlTransactionManager}），與帳務寫入（PostgreSQL）解耦，
 * 避免查詢與扣款/入帳的寫入鎖競爭（ADR-001）。此處資料為最終一致性。
 */
@Service
@RequiredArgsConstructor
public class WalletQueryService {

    private final WalletTransactionViewRepository repository;

    /**
     * 分頁查詢某玩家的帳務流水，支援類型過濾與日期區間。
     *
     * <p>排序固定為建立時間新到舊（同時間再以 id 新到舊），確保分頁穩定。
     * 過濾參數為 null 時表示不套用該維度（見 {@link WalletTransactionViewRepository#search}）。
     *
     * @param playerId 玩家 ID
     * @param type     交易類型 DEBIT/CREDIT/BONUS；null 不過濾（呼叫端負責驗證合法值）
     * @param from     建立時間下界（含）；null 不限
     * @param to       建立時間上界（不含）；null 不限
     * @param page     頁碼（0-based）
     * @param size     每頁筆數
     */
    @Transactional(readOnly = true, transactionManager = "mysqlTransactionManager")
    public PagedResponse<WalletTransactionResponse> getTransactions(
            Long playerId, String type, LocalDateTime from, LocalDateTime to, int page, int size) {

        Pageable pageable = PageRequest.of(page, size,
                Sort.by(Sort.Order.desc("createdAt"), Sort.Order.desc("id")));

        return PagedResponse.from(
                repository.search(playerId, type, from, to, pageable),
                WalletTransactionResponse::from);
    }
}
