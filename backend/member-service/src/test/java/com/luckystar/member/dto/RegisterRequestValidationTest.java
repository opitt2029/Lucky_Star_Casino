package com.luckystar.member.dto;

import jakarta.validation.ConstraintViolation;
import jakarta.validation.Validation;
import jakarta.validation.Validator;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

import java.time.LocalDate;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;

class RegisterRequestValidationTest {

    private static Validator validator;

    @BeforeAll
    static void setUpValidator() {
        validator = Validation.buildDefaultValidatorFactory().getValidator();
    }

    @Test
    void acceptsConfirmedAdultRegistration() {
        RegisterRequest request = validRequest();
        request.setBirthDate(LocalDate.now().minusYears(18));
        request.setAdultConfirmed(true);

        assertThat(validator.validate(request)).isEmpty();
    }

    @Test
    void rejectsUnderageRegistration() {
        RegisterRequest request = validRequest();
        request.setBirthDate(LocalDate.now().minusYears(18).plusDays(1));
        request.setAdultConfirmed(true);

        assertThat(messages(validator.validate(request)))
                .contains("Member must be at least 18 years old");
    }

    @Test
    void rejectsRegistrationWithoutAdultConfirmation() {
        RegisterRequest request = validRequest();
        request.setBirthDate(LocalDate.now().minusYears(20));
        request.setAdultConfirmed(false);

        assertThat(messages(validator.validate(request)))
                .contains("Adult confirmation is required");
    }

    @Test
    void rejectsMissingBirthDate() {
        RegisterRequest request = validRequest();
        request.setBirthDate(null);
        request.setAdultConfirmed(true);

        assertThat(messages(validator.validate(request)))
                .contains("Birth date is required", "Member must be at least 18 years old");
    }

    private static RegisterRequest validRequest() {
        RegisterRequest request = new RegisterRequest();
        request.setUsername("adult-player");
        request.setEmail("adult@example.com");
        request.setPassword("password123");
        request.setNickname("Adult Player");
        return request;
    }

    private static Set<String> messages(Set<ConstraintViolation<RegisterRequest>> violations) {
        return violations.stream()
                .map(ConstraintViolation::getMessage)
                .collect(java.util.stream.Collectors.toSet());
    }
}
