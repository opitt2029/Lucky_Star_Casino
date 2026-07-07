package com.luckystar.wallet.containers;

import com.luckystar.wallet.mysql.entity.WalletTransactionView;
import com.luckystar.wallet.mysql.repository.WalletTransactionViewRepository;
import com.luckystar.wallet.postgres.entity.WalletTransaction;
import com.luckystar.wallet.postgres.repository.WalletTransactionRepository;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.DataAccessException;
import org.springframework.dao.DataIntegrityViolationException;

import java.time.LocalDateTime;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * chk_wt_sub_type CHECK 約束守門（PG 寫端 / MySQL 讀端各一）。
 *
 * <p>H2 測試（ddl-auto=create）由 entity 建表，DB 裡根本沒有這條 CHECK，
 * 非法 sub_type 會靜默寫入成功——這正是本測試存在的理由：驗證真 schema
 * 會在 DB 層擋下繞過 @Pattern 的寫入（AGENTS.md 雷區 18 的最後一道防線）。
 */
class WalletCheckConstraintContainerTest extends AbstractDualDatasourceContainerTest {

    /** 專屬本測試類的 playerId 區段，避免與其他共用容器的測試類互踩。 */
    private static final Long PLAYER = 910001L;

    @Autowired WalletTransactionRepository walletTransactionRepository;       // PostgreSQL 寫端
    @Autowired WalletTransactionViewRepository walletTransactionViewRepository; // MySQL 讀端

    @AfterEach
    void cleanUp() {
        walletTransactionRepository.findAll().stream()
                .filter(tx -> PLAYER.equals(tx.getPlayerId()))
                .forEach(walletTransactionRepository::delete);
        walletTransactionViewRepository.findAll().stream()
                .filter(v -> PLAYER.equals(v.getPlayerId()))
                .forEach(walletTransactionViewRepository::delete);
    }

    @Test
    void postgres_invalidSubType_rejectedByCheckConstraint() {
        WalletTransaction tx = WalletTransaction.builder()
                .playerId(PLAYER)
                .type("DEBIT")
                .subType("HACKED_SUB_TYPE")
                .amount(100L)
                .idempotencyKey("containers-chk-pg-1")
                .build();

        assertThatThrownBy(() -> walletTransactionRepository.saveAndFlush(tx))
                .isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining("chk_wt_sub_type");
    }

    @Test
    void postgres_whitelistedSubType_accepted() {
        // 對照組：白名單內的最新子型（V13 SHOP_PURCHASE）要能寫入——
        // 若 migration 重放順序錯誤（字母序讓 V9 蓋掉 V13），這裡會紅。
        WalletTransaction tx = WalletTransaction.builder()
                .playerId(PLAYER)
                .type("DEBIT")
                .subType("SHOP_PURCHASE")
                .amount(100L)
                .idempotencyKey("containers-chk-pg-2")
                .build();

        WalletTransaction saved = walletTransactionRepository.saveAndFlush(tx);
        assertThat(saved.getId()).isNotNull();
    }

    @Test
    void mysql_invalidSubType_rejectedByCheckConstraint() {
        WalletTransactionView view = WalletTransactionView.builder()
                .id(9_100_001L) // 讀端主鍵由寫端帶入，測試手動給定
                .playerId(PLAYER)
                .type("DEBIT")
                .subType("HACKED_SUB_TYPE")
                .amount(100L)
                .createdAt(LocalDateTime.now())
                .build();

        // MySQL 的 CHECK 違反（SQLState HY000/3819）Hibernate 不會映成 ConstraintViolation，
        // Spring 端拿到的是 JpaSystemException；斷言放寬到共同父類 DataAccessException，
        // 重點是「DB 真的擋下」且訊息點名 chk_wt_sub_type。
        assertThatThrownBy(() -> walletTransactionViewRepository.saveAndFlush(view))
                .isInstanceOf(DataAccessException.class)
                .hasMessageContaining("chk_wt_sub_type");
    }
}
