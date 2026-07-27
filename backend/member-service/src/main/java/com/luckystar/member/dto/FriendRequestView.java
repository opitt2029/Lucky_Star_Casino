package com.luckystar.member.dto;

import java.time.LocalDateTime;

public record FriendRequestView(
        Long friendshipId,
        Long requesterId,
        String requesterUsername,
        String requesterNickname,
        String requesterAvatarUrl,
        LocalDateTime requestedAt
) {}
