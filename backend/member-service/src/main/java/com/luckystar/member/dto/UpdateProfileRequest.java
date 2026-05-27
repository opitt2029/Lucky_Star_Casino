package com.luckystar.member.dto;

import com.luckystar.member.validation.ValidAvatarUrl;
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
}
