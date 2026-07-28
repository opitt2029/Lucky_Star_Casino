package com.luckystar.member.dto;

import jakarta.validation.constraints.AssertTrue;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Past;
import jakarta.validation.constraints.Size;
import lombok.Getter;
import lombok.Setter;

import java.time.LocalDate;

@Getter
@Setter
public class SocialRegistrationRequest {

    @NotBlank
    private String ticket;

    @NotBlank
    @Size(min = 3, max = 50)
    private String username;

    @NotBlank
    @Email
    @Size(max = 100)
    private String email;

    @NotBlank
    @Size(min = 2, max = 50)
    private String nickname;

    @NotNull
    @Past
    private LocalDate birthDate;

    @AssertTrue(message = "You must confirm that you are at least 18 years old")
    private boolean adultConfirmed;
}
