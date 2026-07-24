package com.luckystar.member.exception;

import lombok.Getter;
import org.springframework.http.HttpStatus;

@Getter
public class SocialOAuthException extends RuntimeException {

    private final HttpStatus status;

    public SocialOAuthException(HttpStatus status, String message) {
        super(message);
        this.status = status;
    }
}
