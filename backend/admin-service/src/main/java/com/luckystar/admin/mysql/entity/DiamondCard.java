package com.luckystar.admin.mysql.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.PrePersist;
import jakarta.persistence.Table;
import java.time.LocalDateTime;

/**
 * 鑽石點數卡（MySQL {@code diamond_cards}，T-100 schema）。
 * 後台批量產生（T-105），玩家輸入 {@code cardCode} 兌換鑽石（T-102，由 wallet/game 處理）；
 * admin 僅負責產生與查詢（T-105/T-106），不處理兌換。
 */
@Entity
@Table(name = "diamond_cards")
public class DiamondCard {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "card_code", nullable = false, unique = true, length = 50)
    private String cardCode;

    @Column(name = "face_value", nullable = false)
    private Long faceValue;

    @Column(name = "is_redeemed", nullable = false)
    private boolean redeemed;

    @Column(name = "redeemed_by")
    private Long redeemedBy;

    @Column(name = "redeemed_at")
    private LocalDateTime redeemedAt;

    @Column(name = "created_at", nullable = false, updatable = false)
    private LocalDateTime createdAt;

    public DiamondCard() {
    }

    public DiamondCard(String cardCode, Long faceValue) {
        this.cardCode = cardCode;
        this.faceValue = faceValue;
        this.redeemed = false;
    }

    @PrePersist
    void onCreate() {
        if (createdAt == null) {
            createdAt = LocalDateTime.now();
        }
    }

    public Long getId() {
        return id;
    }

    public String getCardCode() {
        return cardCode;
    }

    public Long getFaceValue() {
        return faceValue;
    }

    public boolean isRedeemed() {
        return redeemed;
    }

    public Long getRedeemedBy() {
        return redeemedBy;
    }

    public LocalDateTime getRedeemedAt() {
        return redeemedAt;
    }

    public LocalDateTime getCreatedAt() {
        return createdAt;
    }
}
