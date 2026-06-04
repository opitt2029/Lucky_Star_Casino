package com.luckystar.rank.kafka;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

@JsonIgnoreProperties(ignoreUnknown = true)
public record MemberRegisteredEvent(
        Long playerId,
        String username
) {}
