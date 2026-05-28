package com.luckystar.wallet.dto;

public class WalletBalanceResponse {

    private final Long balance;
    private final Long frozenAmount;
    private final Long availableBalance;

    public WalletBalanceResponse(Long balance, Long frozenAmount, Long availableBalance) {
        this.balance          = balance;
        this.frozenAmount     = frozenAmount;
        this.availableBalance = availableBalance;
    }

    public Long getBalance()          { return balance; }
    public Long getFrozenAmount()     { return frozenAmount; }
    public Long getAvailableBalance() { return availableBalance; }
}
