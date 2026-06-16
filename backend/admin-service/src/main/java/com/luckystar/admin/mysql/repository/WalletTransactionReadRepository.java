package com.luckystar.admin.mysql.repository;

import com.luckystar.admin.mysql.entity.WalletTransactionRead;
import java.time.LocalDateTime;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;

/**
 * 帳務流水唯讀查詢（MySQL 讀庫）。供玩家詳情近期流水（T-051）與流通量報表（T-052）。
 */
public interface WalletTransactionReadRepository extends JpaRepository<WalletTransactionRead, Long> {

    List<WalletTransactionRead> findTop20ByPlayerIdOrderByCreatedAtDesc(Long playerId);

    /** 報表用：取區間內所有流水（含起訖；於 service 端依維度彙整）。 */
    List<WalletTransactionRead> findByCreatedAtBetween(LocalDateTime from, LocalDateTime to);
}
