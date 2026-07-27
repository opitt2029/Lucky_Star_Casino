package com.luckystar.rank.dto;

public enum RankCategory {
    COINS,
    DAILY_WINNINGS,
    SLOT,
    BACCARAT,
    FISHING;

    public boolean isGame() {
        return this == SLOT || this == BACCARAT || this == FISHING;
    }
}
