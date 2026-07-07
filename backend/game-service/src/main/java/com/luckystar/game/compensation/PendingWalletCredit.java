package com.luckystar.game.compensation;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.PrePersist;
import jakarta.persistence.Table;
import java.time.LocalDateTime;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

/**
 * 待送出的 wallet credit 補償單（{@code pending_wallet_credits}，schema 見 V14 migration，ADR-009）。
 *
 * <p>game→wallet 的 credit（派彩/退款）是同步 HTTP 呼叫；wallet 短暫不可用時，這筆「欠玩家的錢」
 * 原本只剩一行 log。本實體把它落地為補償單，由 {@link WalletCompensationRetryJob} 帶
 * <b>與原始呼叫完全相同的冪等鍵</b>重試——wallet 端 {@code idempotency_key} UNIQUE（雷區 8）
 * 保證「原始請求其實已成功」或「補償與重試並發」時都絕不重複入帳。
 *
 * <p>語意注意：settle 的 credit 失敗＝玩家贏了 → 補償是「重試同一冪等鍵的 credit」（sub_type=WIN，
 * 不是退款）；fishing buy-in/top-up 在扣款後 session 建立失敗 → 退款（sub_type=REFUND）。
 * 兩者統一抽象為「pending outbound wallet credit」。
 */
@Getter
@Setter
@NoArgsConstructor
@Entity
@Table(name = "pending_wallet_credits")
public class PendingWalletCredit {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /** SLOT / BACCARAT / FISHING。 */
    @Column(name = "game_type", nullable = false, length = 20)
    private String gameType;

    /** 對局 roundId 或捕魚 sessionId（重試時作為 credit 的 referenceId）。 */
    @Column(name = "round_id", nullable = false, length = 100)
    private String roundId;

    @Column(name = "player_id", nullable = false)
    private Long playerId;

    /** 欠付金額（星幣）。 */
    @Column(name = "amount", nullable = false)
    private long amount;

    /** WIN（結算派彩）/ REFUND（buy-in/top-up 退款、捕魚場次返還）。皆已在 CreditRequest 白名單。 */
    @Column(name = "sub_type", nullable = false, length = 20)
    private String subType;

    /** 與原始 credit 呼叫完全相同的冪等鍵（補償不重複入帳的安全根基）。 */
    @Column(name = "idempotency_key", nullable = false, length = 100, unique = true)
    private String idempotencyKey;

    /** PENDING → DONE（補償入帳成功）/ FAILED（重試超限，需人工對帳）。 */
    @Column(name = "status", nullable = false, length = 20)
    private String status = "PENDING";

    @Column(name = "retry_count", nullable = false)
    private int retryCount;

    /** 最近一次失敗原因（截斷至 500 字保存，供人工對帳定位）。 */
    @Column(name = "last_error", length = 500)
    private String lastError;

    /** 指數退避的下次重試時間；排程只撈 {@code next_retry_at <= now} 的 PENDING 單。 */
    @Column(name = "next_retry_at", nullable = false)
    private LocalDateTime nextRetryAt;

    @Column(name = "created_at", nullable = false, updatable = false)
    private LocalDateTime createdAt;

    @Column(name = "done_at")
    private LocalDateTime doneAt;

    @PrePersist
    void prePersist() {
        if (createdAt == null) createdAt = LocalDateTime.now();
        if (nextRetryAt == null) nextRetryAt = LocalDateTime.now();
    }
}
