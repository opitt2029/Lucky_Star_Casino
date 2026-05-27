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
    private String role;
    private String createdAt;
}
