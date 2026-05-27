package com.luckystar.member.validation;

import jakarta.validation.Constraint;
import jakarta.validation.Payload;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

@Constraint(validatedBy = AvatarUrlValidator.class)
@Target({ElementType.FIELD})
@Retention(RetentionPolicy.RUNTIME)
public @interface ValidAvatarUrl {

    String message() default "Avatar must be a valid URL or Base64 data URI";

    Class<?>[] groups() default {};

    Class<? extends Payload>[] payload() default {};
}
