package com.luckystar.member.dto;

import lombok.AllArgsConstructor;
import lombok.Getter;

@Getter
@AllArgsConstructor
public class SocialLoginStartResponse {

    private String provider;
    private String label;
    private String authorizationUrl;
}
