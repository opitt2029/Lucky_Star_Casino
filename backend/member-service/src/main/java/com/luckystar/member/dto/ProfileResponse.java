package com.luckystar.member.dto;

import lombok.AllArgsConstructor;
import lombok.Getter;

@Getter
@AllArgsConstructor
public class ProfileResponse {

    private Long playerId;
    private String username;
    private String nickname;
    private String avatar;
    private String realName;
    private String birthDate;
    private String gender;
    private String address;
    private String walletPaymentMethod;
    private Boolean paymentConfirmationEnabled;
    private Boolean newGiftClaimed;
    private String role;
    private String createdAt;
}
