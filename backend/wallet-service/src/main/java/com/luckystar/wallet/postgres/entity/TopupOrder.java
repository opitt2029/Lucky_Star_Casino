package com.luckystar.wallet.postgres.entity;

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
 * 玩家自助加值訂單（模擬支付，無真實金流）。
 *
 * <p>狀態流轉：{@code CREATED}（建單）→ {@code PAID}（模擬付款）→ {@code CREDITED}（星幣已入帳）；
 * 入帳階段若發生例外則記為 {@code FAILED}。付款成功後以 {@code orderNo} 當冪等鍵呼叫
 * {@link com.luckystar.wallet.service.WalletService#credit} 真實入帳，{@code creditTxId} 記錄入帳流水 id。
 */
@Entity
@Table(name = "topup_orders")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class TopupOrder {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /** 訂單編號，冪等鍵來源（入帳冪等鍵為 "topup-" + orderNo）。 */
    @Column(name = "order_no", nullable = false, length = 40, unique = true)
    private String orderNo;

    @Column(name = "player_id", nullable = false)
    private Long playerId;

    /** 方案代號（如 P100 / P500 / P1000）。 */
    @Column(name = "package_id", nullable = false, length = 20)
    private String packageId;

    /** 入帳星幣數。 */
    @Column(name = "amount", nullable = false)
    private Long amount;

    /** 顯示用售價（如 NT$100）。 */
    @Column(name = "price_label", nullable = false, length = 20)
    private String priceLabel;

    /** CREATED / PAID / CREDITED / FAILED。 */
    @Column(name = "status", nullable = false, length = 20)
    private String status;

    /** 入帳成功後的 wallet_transactions.id。 */
    @Column(name = "credit_tx_id")
    private Long creditTxId;

    @Column(name = "created_at", nullable = false, updatable = false)
    private LocalDateTime createdAt;

    @Column(name = "paid_at")
    private LocalDateTime paidAt;

    @PrePersist
    void prePersist() {
        if (this.createdAt == null) {
            this.createdAt = LocalDateTime.now();
        }
        if (this.status == null) {
            this.status = "CREATED";
        }
    }
}
