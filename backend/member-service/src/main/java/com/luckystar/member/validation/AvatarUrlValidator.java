package com.luckystar.member.validation;

import jakarta.validation.ConstraintValidator;
import jakarta.validation.ConstraintValidatorContext;

import java.util.regex.Pattern;

public class AvatarUrlValidator implements ConstraintValidator<ValidAvatarUrl, String> {

    private static final Pattern HTTP_PATTERN =
            Pattern.compile("^https?://.*", Pattern.CASE_INSENSITIVE);

    private static final Pattern DATA_URI_PATTERN =
            Pattern.compile("^data:image/(jpeg|png|gif|webp);base64,.*", Pattern.CASE_INSENSITIVE);

    @Override
    public boolean isValid(String value, ConstraintValidatorContext context) {
        // null 或空白視為「不更新」，由上層業務邏輯處理
        if (value == null || value.isBlank()) {
            return true;
        }
        return HTTP_PATTERN.matcher(value).matches()
                || DATA_URI_PATTERN.matcher(value).matches();
    }
}
