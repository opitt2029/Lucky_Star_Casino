package com.luckystar.game.dto;

import lombok.Builder;
import lombok.Data;

/**
 * 回應中嵌入的錢包視圖，形狀與前端 walletSlice 期望一致：{@code { balance, frozenAmount }}。
 */
@Data
@Builder
public class WalletView {

    /** 結算後可用餘額（星幣）。 */
    private long balance;

    /** 凍結金額（老虎機不凍結，通常為 0）。 */
    private long frozenAmount;
}
