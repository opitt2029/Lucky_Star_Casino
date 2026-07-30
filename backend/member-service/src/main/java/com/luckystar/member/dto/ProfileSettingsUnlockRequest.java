package com.luckystar.member.dto;

import jakarta.validation.constraints.NotBlank;
import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
public class ProfileSettingsUnlockRequest {

    @NotBlank
    private String password;
}
