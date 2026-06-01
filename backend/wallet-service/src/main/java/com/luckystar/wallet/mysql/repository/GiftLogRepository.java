package com.luckystar.wallet.mysql.repository;

import com.luckystar.wallet.mysql.entity.GiftLog;
import org.springframework.data.jpa.repository.JpaRepository;

/**
 * MySQL 好友贈幣紀錄 Repository（T-026）。
 * 由 {@code mysqlEntityManagerFactory} / {@code mysqlTransactionManager} 管理
 * （見 {@link com.luckystar.wallet.config.MysqlJpaConfig}）。
 */
public interface GiftLogRepository extends JpaRepository<GiftLog, Long> {
}
