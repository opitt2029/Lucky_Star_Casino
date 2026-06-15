package com.luckystar.admin.postgres.repository;

import com.luckystar.admin.postgres.entity.AdminActionLog;
import org.springframework.data.jpa.repository.JpaRepository;

/**
 * {@code admin_action_logs} 存取（PostgreSQL 寫端，由 {@code postgresTransactionManager} 管理）。
 */
public interface AdminActionLogRepository extends JpaRepository<AdminActionLog, Long> {
}
