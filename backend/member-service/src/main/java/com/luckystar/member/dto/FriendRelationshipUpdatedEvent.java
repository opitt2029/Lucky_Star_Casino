package com.luckystar.member.dto;

import java.util.List;

public record FriendRelationshipUpdatedEvent(
        Long playerId,
        List<Long> friendIds
) {}
