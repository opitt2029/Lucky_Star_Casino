package com.luckystar.member.validation;

import jakarta.validation.ConstraintValidator;
import jakarta.validation.ConstraintValidatorContext;

import java.util.regex.Pattern;

public class AvatarUrlValidator implements ConstraintValidator<ValidAvatarUrl, String> {

    private static final Pattern HTTP_URL_PATTERN =
            Pattern.compile("^https?://[\\w\\-.]+(:\\d+)?(/[\\w\\-./?%&=]*)?$");

    @Override
    public boolean isValid(String value, ConstraintValidatorContext context) {
        if (value == null) {
            return true;
        }
        if (value.startsWith("data:image/") && value.contains(";base64,")) {
            return true;
        }
        return HTTP_URL_PATTERN.matcher(value).matches();
    }
}
