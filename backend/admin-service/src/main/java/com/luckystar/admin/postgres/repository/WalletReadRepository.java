package com.luckystar.admin.postgres.repository;

import com.luckystar.admin.postgres.entity.WalletRead;
import org.springframework.data.jpa.repository.JpaRepository;

/**
 * 錢包餘額唯讀查詢（PostgreSQL 寫庫，由 postgresTransactionManager 管理）。
 */
public interface WalletReadRepository extends JpaRepository<WalletRead, Long> {
}
