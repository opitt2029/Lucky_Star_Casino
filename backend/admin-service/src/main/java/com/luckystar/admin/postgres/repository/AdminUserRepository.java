package com.luckystar.admin.postgres.repository;

import com.luckystar.admin.postgres.entity.AdminUser;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

/**
 * {@code admin_users} 存取（PostgreSQL 寫端，由 {@code postgresTransactionManager} 管理）。
 */
public interface AdminUserRepository extends JpaRepository<AdminUser, Long> {

    Optional<AdminUser> findByUsername(String username);

    boolean existsByUsername(String username);
}
