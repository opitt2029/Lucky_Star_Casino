package com.luckystar.member.dto;

import lombok.AllArgsConstructor;
import lombok.Getter;

@Getter
@AllArgsConstructor
public class RefreshResponse {

    private String accessToken;
    private String refreshToken;
    private String tokenType = "Bearer";
    private long expiresIn = 900;

    public RefreshResponse(String accessToken, String refreshToken) {
        this.accessToken = accessToken;
        this.refreshToken = refreshToken;
    }
}
