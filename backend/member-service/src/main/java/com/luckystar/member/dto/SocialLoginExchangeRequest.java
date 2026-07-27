package com.luckystar.member.dto;

import jakarta.validation.constraints.NotBlank;
import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
public class SocialLoginExchangeRequest {

    @NotBlank(message = "Login ticket is required")
    private String ticket;
}
