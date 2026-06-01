package com.luckystar.wallet.mysql.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.PrePersist;
import jakarta.persistence.Table;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.LocalDateTime;

/**
 * 鑽石點數卡（序號）表（T-100/T-102）。對應 {@code database/mysql/migration/V5__add_diamond_cards.sql}
 * 的 {@code diamond_cards}。
 *
 * <p>由後台批量產生（T-105），玩家輸入 {@code card_code} 兌換鑽石（T-102，{@code POST
 * /api/v1/wallet/diamond/redeem}）。{@code card_code} UNIQUE 約束保證序號不重複；{@code is_redeemed}
 * 旗標 + 條件式 UPDATE（CAS，見 {@link com.luckystar.wallet.mysql.repository.DiamondCardRepository#markRedeemed}）
 * 保證「同一序號只能被兌換一次」，即使並發雙擊也只有一方能 flip 成功。
 *
 * <p>位於 MySQL（CQRS 讀端，ADR-001），由 {@code mysqlEntityManagerFactory} /
 * {@code mysqlTransactionManager} 管理（package {@code com.luckystar.wallet.mysql.entity}）。鑽石餘額本身
 * 在 PostgreSQL 寫端的 {@code diamond_wallets}，故兌換是「跨資料源」操作——刻意不引入 XA：以「先 CAS 標記
 * 序號、再入帳鑽石、入帳失敗則回滾序號」的補償流程處理，詳見
 * {@link com.luckystar.wallet.service.DiamondRedeemService}。
 */
@Entity
@Table(name = "diamond_cards")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class DiamondCard {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /** 點數卡序號，格式 XXXX-XXXX-XXXX-XXXX。UNIQUE。 */
    @Column(name = "card_code", nullable = false, unique = true)
    private String cardCode;

    /** 面額：兌換可得的鑽石數（>0）。 */
    @Column(name = "face_value", nullable = false)
    private Long faceValue;

    /** 是否已兌換：false 未兌換 / true 已兌換。防重複兌換的核心旗標。 */
    @Column(name = "is_redeemed", nullable = false)
    @Builder.Default
    private Boolean isRedeemed = false;

    /** 兌換玩家 playerId（未兌換為 null）。 */
    @Column(name = "redeemed_by")
    private Long redeemedBy;

    /** 兌換時間（未兌換為 null）。 */
    @Column(name = "redeemed_at")
    private LocalDateTime redeemedAt;

    @Column(name = "created_at", nullable = false)
    private LocalDateTime createdAt;

    @PrePersist
    void prePersist() {
        if (this.createdAt == null) {
            this.createdAt = LocalDateTime.now();
        }
    }
}
