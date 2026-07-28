package com.luckystar.member.dto;

import lombok.AllArgsConstructor;
import lombok.Getter;

@Getter
@AllArgsConstructor
public class SocialRegistrationPreviewResponse {

    private String provider;
    private String providerLabel;
    private String email;
    private String displayName;
    private String avatarUrl;
    private boolean emailLocked;
}
