package com.luckystar.admin.postgres.repository;

import com.luckystar.admin.postgres.entity.AdminAlert;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;

/**
 * {@code admin_alerts} 存取（PostgreSQL 寫端，由 {@code postgresTransactionManager} 管理）。
 *
 * 查詢用衍生方法列舉三種篩選組合（type / resolved / 兩者），不用 null 參數 JPQL——
 * Postgres 對 null 綁定參數的型別推斷易踩雷，明確方法各自對應索引也更好讀。
 */
public interface AdminAlertRepository extends JpaRepository<AdminAlert, Long> {

    Page<AdminAlert> findByResolved(boolean resolved, Pageable pageable);

    Page<AdminAlert> findByAlertType(String alertType, Pageable pageable);

    Page<AdminAlert> findByAlertTypeAndResolved(String alertType, boolean resolved, Pageable pageable);
}
