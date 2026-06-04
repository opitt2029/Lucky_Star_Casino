package com.luckystar.rank.kafka;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import java.util.List;

@JsonIgnoreProperties(ignoreUnknown = true)
public record FriendRelationshipUpdatedEvent(
        Long playerId,
        List<Long> friendIds
) {}
