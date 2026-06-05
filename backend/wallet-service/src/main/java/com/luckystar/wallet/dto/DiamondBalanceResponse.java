package com.luckystar.wallet.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;

@Getter
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class DiamondBalanceResponse {

    private long balance;

    @Builder.Default
    private int exchangeRate = 20;
}
