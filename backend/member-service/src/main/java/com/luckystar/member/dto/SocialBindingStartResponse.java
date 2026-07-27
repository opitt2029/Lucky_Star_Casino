package com.luckystar.member.dto;

import lombok.AllArgsConstructor;
import lombok.Getter;

@Getter
@AllArgsConstructor
public class SocialBindingStartResponse {

    private String provider;
    private String label;
    private String status;
    private String authorizationUrl;
}
