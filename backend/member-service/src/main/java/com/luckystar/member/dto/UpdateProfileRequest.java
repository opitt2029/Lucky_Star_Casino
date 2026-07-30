package com.luckystar.member.dto;

import com.luckystar.member.validation.ValidAvatarUrl;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
public class UpdateProfileRequest {

    @Size(min = 2, max = 50, message = "Nickname must be between 2 and 50 characters")
    private String nickname;

    @ValidAvatarUrl
    private String avatar;

    @Pattern(regexp = "^(MALE|FEMALE|PREFER_NOT_TO_SAY)?$",
            message = "Gender must be one of MALE, FEMALE, PREFER_NOT_TO_SAY")
    private String gender;

    @Size(max = 255, message = "Address must be at most 255 characters")
    private String address;

    @Pattern(regexp = "^(STAR_COIN|DIAMOND|ASK_EVERY_TIME)?$",
            message = "Wallet payment method must be STAR_COIN, DIAMOND, or ASK_EVERY_TIME")
    private String walletPaymentMethod;

    private Boolean paymentConfirmationEnabled;

    private String currentPassword;
}
