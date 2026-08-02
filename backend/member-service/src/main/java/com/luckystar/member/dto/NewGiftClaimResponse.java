package com.luckystar.member.dto;

import lombok.AllArgsConstructor;
import lombok.Getter;

@Getter
@AllArgsConstructor
public class NewGiftClaimResponse {

    private long amount;
    private boolean claimed;
    private boolean alreadyClaimed;
}