package com.luckystar.member.validation;

import jakarta.validation.Constraint;
import jakarta.validation.Payload;

import java.lang.annotation.*;

@Target({ElementType.FIELD, ElementType.PARAMETER})
@Retention(RetentionPolicy.RUNTIME)
@Documented
@Constraint(validatedBy = AvatarUrlValidator.class)
public @interface ValidAvatarUrl {

    String message() default "Avatar must be a valid URL (http/https) or Base64 data URI (data:image/...)";

    Class<?>[] groups() default {};

    Class<? extends Payload>[] payload() default {};
}
