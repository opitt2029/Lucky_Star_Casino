package com.luckystar.member.dto;

import jakarta.validation.constraints.*;
import lombok.Getter;
import lombok.Setter;

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
}
