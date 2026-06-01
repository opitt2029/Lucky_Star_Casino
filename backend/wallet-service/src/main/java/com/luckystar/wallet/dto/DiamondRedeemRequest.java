package com.luckystar.wallet.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import lombok.Data;

/**
 * 點數卡兌換鑽石請求（T-102）。對應 {@code POST /api/v1/wallet/diamond/redeem}。
 *
 * <p>兌換者（playerId）<b>不</b>在 body 內，由 gateway 注入的 {@code X-User-Id} header 決定，
 * 避免冒用他人身分把鑽石入到別人帳上。body 只帶序號。
 */
@Data
public class DiamondRedeemRequest {

    /** 點數卡序號。對齊讀庫 {@code diamond_cards.card_code VARCHAR(50)}。 */
    @NotBlank
    @Size(max = 50)
    private String cardCode;
}
