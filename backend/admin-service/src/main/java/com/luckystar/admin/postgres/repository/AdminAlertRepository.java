package com.luckystar.admin.postgres.repository;

import com.luckystar.admin.postgres.entity.AdminAlert;
import org.springframework.data.jpa.repository.JpaRepository;

/**
 * {@code admin_alerts} 存取（PostgreSQL 寫端，由 {@code postgresTransactionManager} 管理）。
 */
public interface AdminAlertRepository extends JpaRepository<AdminAlert, Long> {
}
