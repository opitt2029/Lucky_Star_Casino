package com.luckystar.member.dto;

import jakarta.validation.constraints.*;
import lombok.Getter;
import lombok.Setter;

import java.time.LocalDate;

@Getter
@Setter
public class RegisterRequest {

    @NotBlank
    @Size(min = 3, max = 50)
    private String username;

    @NotBlank
    @Email
    @Size(max = 100)
    private String email;

    @NotBlank
    @Pattern(regexp = "^(?=.*[A-Za-z])(?=.*\\d).{8,}$",
             message = "Password must be at least 8 characters and contain both letters and digits")
    private String password;

    @NotBlank
    @Size(min = 2, max = 50)
    private String nickname;

    @NotNull(message = "Birth date is required")
    @Past(message = "Birth date must be in the past")
    private LocalDate birthDate;

    @AssertTrue(message = "Adult confirmation is required")
    private boolean adultConfirmed;

    @AssertTrue(message = "Member must be at least 18 years old")
    public boolean isAdult() {
        return birthDate != null && !birthDate.isAfter(LocalDate.now().minusYears(18));
    }
}
