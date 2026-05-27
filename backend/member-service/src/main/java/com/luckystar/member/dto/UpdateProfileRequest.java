package com.luckystar.member.dto;

import com.luckystar.member.validation.ValidAvatarUrl;
import jakarta.validation.constraints.Size;

public class UpdateProfileRequest {

    @Size(max = 50)
    private String nickname;

    @Size(max = 500)
    @ValidAvatarUrl
    private String avatarUrl;

    public String getNickname() { return nickname; }
    public void setNickname(String nickname) { this.nickname = nickname; }

    public String getAvatarUrl() { return avatarUrl; }
    public void setAvatarUrl(String avatarUrl) { this.avatarUrl = avatarUrl; }
}
