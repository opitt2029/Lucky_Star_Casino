package com.luckystar.member.validation;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

class AvatarUrlValidatorTest {

    private AvatarUrlValidator validator;

    @BeforeEach
    void setUp() {
        validator = new AvatarUrlValidator();
    }

    @Test
    void https_url_returns_true() {
        assertTrue(validator.isValid("https://cdn.example.com/avatar.png", null));
    }

    @Test
    void http_url_returns_true() {
        assertTrue(validator.isValid("http://cdn.example.com/avatar.png", null));
    }

    @Test
    void data_image_png_base64_returns_true() {
        assertTrue(validator.isValid("data:image/png;base64,iVBORw0KGgo=", null));
    }

    @Test
    void invalid_string_returns_false() {
        assertFalse(validator.isValid("not-a-url", null));
    }

    @Test
    void null_returns_true() {
        assertTrue(validator.isValid(null, null));
    }

    @Test
    void blank_string_returns_true() {
        assertTrue(validator.isValid("   ", null));
    }
}
