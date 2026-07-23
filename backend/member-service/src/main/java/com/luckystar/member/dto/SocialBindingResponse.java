package com.luckystar.member.dto;

import lombok.AllArgsConstructor;
import lombok.Getter;

@Getter
@AllArgsConstructor
public class SocialBindingResponse {

    private String provider;
    private String label;
    private boolean bound;
    private String status;
    private String connectUrl;
    private String maskedAccountId;
}
