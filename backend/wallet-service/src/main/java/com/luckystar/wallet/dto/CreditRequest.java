package com.luckystar.wallet.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.PositiveOrZero;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Size;
import lombok.Data;

/**
 * 派彩 / 入帳請求（T-023）。對應 {@code POST /internal/wallet/credit}。
 *
 * <p>設計上與 {@link DebitRequest}（扣款）對稱，差別在於：
 * <ul>
 *   <li>credit 是「加錢」，不需要餘額守衛（debit 才需要檢查餘額是否足夠）。</li>
 *   <li>credit 的來源很多元（中獎、簽到、任務、贈送、GM 補發…），所以多了 {@code subType} 欄位；
 *       debit 目前固定是下注（BET），不需要。</li>
 *   <li>credit 可選擇性「解凍」先前下注時凍結的金額（{@code unfreezeAmount}）。</li>
 * </ul>
 */
@Data
public class CreditRequest {

    /** 入帳對象玩家 ID。 */
    @NotNull
    private Long playerId;

    /** 入帳金額（星幣），必須為正數（DB 也有 amount > 0 的 CHECK 約束）。 */
    @NotNull
    @Positive
    private Long amount;

    /**
     * 帳務子類型，必須是 DB 約束允許的 CREDIT 類子型之一。
     * 對應 schema：sub_type CHECK IN ('BET','WIN','CHECKIN','TASK','GIFT','GM_REWARD','BANKRUPTCY_AID','DIAMOND_EXCHANGE','TOPUP','CASHBACK','REFUND')。
     * BET 屬於扣款，不在此允許清單。REFUND 用於退款／本金返還（如捕魚 buy-in 退款、場次結算返還剩餘局內餘額）。
     */
    @NotBlank
    @Pattern(regexp = "WIN|CHECKIN|TASK|GIFT|GM_REWARD|BANKRUPTCY_AID|DIAMOND_EXCHANGE|TOPUP|CASHBACK|REFUND",
             message = "subType must be one of WIN/CHECKIN/TASK/GIFT/GM_REWARD/BANKRUPTCY_AID/DIAMOND_EXCHANGE/TOPUP/CASHBACK/REFUND")
    private String subType;

    /**
     * 冪等鍵：同一個 key 只會真正入帳一次（DB 對 idempotency_key 有 UNIQUE 約束）。
     * 例如派彩用 "credit-round-{roundId}"、簽到用 "checkin-{playerId}-{date}"。
     */
    @NotBlank
    @Size(max = 100)
    private String idempotencyKey;

    /** 關聯 ID（選填），例如遊戲的 roundId、活動的 eventId，方便事後對帳追溯。 */
    @Size(max = 100)
    private String referenceId;

    /**
     * 要解凍的凍結金額（選填，預設 0）。
     * 用於「下注時先凍結、結算時解凍」的流程：派彩入帳時把先前凍結的下注額釋放掉。
     * 目前 debit 尚未實作凍結流程，故此欄位多半傳 0 或不傳；保留以利未來串接，不會破壞既有呼叫。
     */
    @PositiveOrZero
    private Long unfreezeAmount;
}
