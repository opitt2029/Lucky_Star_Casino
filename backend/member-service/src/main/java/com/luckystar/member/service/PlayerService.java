package com.luckystar.member.service;

import com.luckystar.member.dto.ProfileResponse;
import com.luckystar.member.dto.SocialBindingResponse;
import com.luckystar.member.dto.SocialBindingStartResponse;
import com.luckystar.member.dto.UpdateProfileRequest;
import com.luckystar.member.entity.Member;
import com.luckystar.member.entity.MemberSocialAccount;
import com.luckystar.member.exception.InvalidCredentialsException;
import com.luckystar.member.exception.MemberNotFoundException;
import com.luckystar.member.exception.NoUpdateFieldException;
import com.luckystar.member.repository.MemberRepository;
import com.luckystar.member.repository.MemberSocialAccountRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

import java.time.format.DateTimeFormatter;
import java.util.Arrays;
import java.util.Map;
import java.util.List;
import java.util.function.Function;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
public class PlayerService {

    private static final DateTimeFormatter FORMATTER = DateTimeFormatter.ISO_LOCAL_DATE_TIME;

    private final MemberRepository memberRepository;
    private final MemberSocialAccountRepository socialAccountRepository;
    private final SocialAuthService socialAuthService;
    private final PasswordEncoder passwordEncoder;

    @Transactional(readOnly = true)
    public ProfileResponse getProfile(Long playerId) {
        Member member = findMember(playerId);
        return mapToResponse(member);
    }

    @Transactional(readOnly = true)
    public void verifyProfileSettingsPassword(Long playerId, String password) {
        Member member = findMember(playerId);
        verifyPassword(member, password);
    }

    @Transactional
    public ProfileResponse updateProfile(Long playerId, UpdateProfileRequest request) {
        if (!hasAnyUpdateField(request)) {
            throw new NoUpdateFieldException(
                    "At least one profile field must be provided");
        }

        Member member = findMember(playerId);
        if (hasSensitiveUpdateField(request)) {
            verifyPassword(member, request.getCurrentPassword());
        }

        if (request.getNickname() != null) {
            member.setNickname(request.getNickname());
        }
        if (request.getAvatar() != null) {
            member.setAvatar(request.getAvatar());
        }
        if (request.getGender() != null) {
            member.setGender(blankToNull(request.getGender()));
        }
        if (request.getAddress() != null) {
            member.setAddress(blankToNull(request.getAddress()));
        }
        if (request.getWalletPaymentMethod() != null) {
            member.setWalletPaymentMethod(StringUtils.hasText(request.getWalletPaymentMethod())
                    ? request.getWalletPaymentMethod()
                    : "STAR_COIN");
        }
        if (request.getPaymentConfirmationEnabled() != null) {
            member.setPaymentConfirmationEnabled(request.getPaymentConfirmationEnabled());
        }

        memberRepository.save(member);
        return mapToResponse(member);
    }

    @Transactional(readOnly = true)
    public List<SocialBindingResponse> getSocialBindings(Long playerId) {
        findMember(playerId);
        Map<String, MemberSocialAccount> accounts = socialAccountRepository
                .findAllByMemberId(playerId)
                .stream()
                .collect(Collectors.toMap(
                        MemberSocialAccount::getProvider,
                        Function.identity()));
        return Arrays.stream(SocialProvider.values())
                .map(provider -> socialBinding(provider, accounts.get(provider.id())))
                .toList();
    }

    public SocialBindingStartResponse startSocialBinding(Long playerId, String providerId) {
        return socialAuthService.startBinding(playerId, providerId);
    }

    @Transactional
    public SocialBindingResponse removeSocialBinding(Long playerId, String providerId) {
        findMember(playerId);
        SocialProvider provider = SocialProvider.fromId(providerId);
        socialAccountRepository.findByMemberIdAndProvider(playerId, provider.id())
                .ifPresent(socialAccountRepository::delete);
        return socialBinding(provider, null);
    }

    @Transactional
    public String updateStatus(Long memberId, boolean enabled) {
        Member member = findMember(memberId);
        member.setStatus(enabled ? "ACTIVE" : "DISABLED");
        memberRepository.save(member);
        return member.getStatus();
    }

    private Member findMember(Long playerId) {
        return memberRepository.findById(playerId)
                .orElseThrow(() -> new MemberNotFoundException("Member not found: " + playerId));
    }

    private void verifyPassword(Member member, String password) {
        if (!StringUtils.hasText(password)
                || !StringUtils.hasText(member.getPasswordHash())
                || !passwordEncoder.matches(password, member.getPasswordHash())) {
            throw new InvalidCredentialsException("Invalid profile settings password");
        }
    }

    private boolean hasAnyUpdateField(UpdateProfileRequest request) {
        return request.getNickname() != null
                || request.getAvatar() != null
                || hasSensitiveUpdateField(request);
    }

    private boolean hasSensitiveUpdateField(UpdateProfileRequest request) {
        return request.getGender() != null
                || request.getAddress() != null
                || request.getWalletPaymentMethod() != null
                || request.getPaymentConfirmationEnabled() != null;
    }

    private String blankToNull(String value) {
        return StringUtils.hasText(value) ? value : null;
    }

    private ProfileResponse mapToResponse(Member member) {
        return new ProfileResponse(
                member.getId(),
                member.getUsername(),
                member.getNickname(),
                member.getAvatar(),
                member.getRealName(),
                member.getBirthDate() != null ? member.getBirthDate().toString() : null,
                member.getGender(),
                member.getAddress(),
                member.getWalletPaymentMethod(),
                member.getPaymentConfirmationEnabled(),
                member.getRole(),
                member.getCreatedAt() != null ? member.getCreatedAt().format(FORMATTER) : null
        );
    }

    private SocialBindingResponse socialBinding(
            SocialProvider provider,
            MemberSocialAccount account) {
        boolean bound = account != null;
        return new SocialBindingResponse(
                provider.id(),
                provider.label(),
                bound,
                bound ? "BOUND" : "UNBOUND",
                "/profile/social-bindings/" + provider.id(),
                bound ? maskAccount(account) : null
        );
    }

    private String maskAccount(MemberSocialAccount account) {
        String email = account.getEmail();
        if (email != null && email.contains("@")) {
            int at = email.indexOf('@');
            String local = email.substring(0, at);
            String visible = local.substring(0, Math.min(2, local.length()));
            return visible + "***" + email.substring(at);
        }
        String subject = account.getProviderSubject();
        if (subject == null || subject.length() <= 4) {
            return "****";
        }
        return "****" + subject.substring(subject.length() - 4);
    }
}
