package com.luckystar.admin.mysql.repository;

import com.luckystar.admin.mysql.entity.DiamondCard;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;

/**
 * 鑽石點數卡存取（MySQL，由 mysqlTransactionManager 管理）。供 T-105 產生 / T-106 查詢。
 */
public interface DiamondCardRepository extends JpaRepository<DiamondCard, Long> {

    boolean existsByCardCode(String cardCode);

    Page<DiamondCard> findByRedeemed(boolean redeemed, Pageable pageable);
}
