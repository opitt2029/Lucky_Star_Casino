package com.luckystar.member.service;

import java.util.Arrays;

public enum SocialProvider {
    LINE("line", "LINE"),
    GOOGLE("google", "Google"),
    APPLE("apple", "Apple");

    private final String id;
    private final String label;

    SocialProvider(String id, String label) {
        this.id = id;
        this.label = label;
    }

    public String id() {
        return id;
    }

    public String label() {
        return label;
    }

    public static SocialProvider fromId(String id) {
        return Arrays.stream(values())
                .filter(provider -> provider.id.equalsIgnoreCase(id))
                .findFirst()
                .orElseThrow(() -> new IllegalArgumentException("Unsupported social provider: " + id));
    }
}
