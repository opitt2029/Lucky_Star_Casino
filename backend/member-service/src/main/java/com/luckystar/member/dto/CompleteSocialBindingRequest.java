package com.luckystar.member.dto;

import jakarta.validation.constraints.Size;
import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
public class CompleteSocialBindingRequest {

    @Size(max = 120, message = "externalAccountId must be at most 120 characters")
    private String externalAccountId;
}
