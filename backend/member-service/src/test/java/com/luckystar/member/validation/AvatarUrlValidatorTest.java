package com.luckystar.member.validation;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.junit.jupiter.MockitoExtension;

import static org.assertj.core.api.Assertions.assertThat;

@ExtendWith(MockitoExtension.class)
class AvatarUrlValidatorTest {

    private AvatarUrlValidator validator;

    @BeforeEach
    void setUp() {
        validator = new AvatarUrlValidator();
    }

    @Test
    void nullValue_isValid() {
        assertThat(validator.isValid(null, null)).isTrue();
    }

    @Test
    void validHttpUrl_isValid() {
        assertThat(validator.isValid("https://example.com/avatar.png", null)).isTrue();
    }

    @Test
    void validBase64DataUri_isValid() {
        assertThat(validator.isValid("data:image/png;base64,abc123", null)).isTrue();
    }

    @Test
    void invalidString_isInvalid() {
        assertThat(validator.isValid("not-a-url", null)).isFalse();
    }

    @Test
    void ftpUrl_isInvalid() {
        assertThat(validator.isValid("ftp://example.com/image.png", null)).isFalse();
    }
}
