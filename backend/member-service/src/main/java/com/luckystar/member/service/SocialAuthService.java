package com.luckystar.member.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.luckystar.member.config.SocialOAuthProperties;
import com.luckystar.member.dto.LoginResponse;
import com.luckystar.member.dto.SocialBindingStartResponse;
import com.luckystar.member.dto.SocialLoginStartResponse;
import com.luckystar.member.entity.Member;
import com.luckystar.member.entity.MemberSocialAccount;
import com.luckystar.member.exception.MemberNotFoundException;
import com.luckystar.member.exception.SocialOAuthException;
import com.luckystar.member.repository.MemberRepository;
import com.luckystar.member.repository.MemberSocialAccountRepository;
import jakarta.servlet.http.HttpSession;
import lombok.RequiredArgsConstructor;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.http.HttpStatus;
import org.springframework.security.oauth2.client.authentication.OAuth2AuthenticationToken;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;
import org.springframework.web.util.UriComponentsBuilder;

import java.util.Map;
import java.util.UUID;

@Service
@RequiredArgsConstructor
public class SocialAuthService {

    private static final String BINDING_TICKET_PREFIX = "oauth:binding-ticket:";
    private static final String LOGIN_TICKET_PREFIX = "oauth:login-ticket:";
    private static final String SESSION_FLOW = "socialOAuthFlow";
    private static final String SESSION_MEMBER_ID = "socialOAuthMemberId";
    private static final String FLOW_LOGIN = "LOGIN";
    private static final String FLOW_BIND = "BIND";

    private final MemberRepository memberRepository;
    private final MemberSocialAccountRepository socialAccountRepository;
    private final AuthService authService;
    private final StringRedisTemplate redisTemplate;
    private final ObjectMapper objectMapper;
    private final SocialOAuthProperties properties;

    public SocialLoginStartResponse startLogin(String providerId) {
        SocialProvider provider = requireEnabledProvider(providerId);
        return new SocialLoginStartResponse(
                provider.id(),
                provider.label(),
                authorizationUrl(provider, null));
    }

    public SocialBindingStartResponse startBinding(Long memberId, String providerId) {
        Member member = memberRepository.findById(memberId)
                .orElseThrow(() -> new MemberNotFoundException("Member not found: " + memberId));
        SocialProvider provider = requireEnabledProvider(providerId);
        String ticket = UUID.randomUUID().toString();
        redisTemplate.opsForValue().set(
                BINDING_TICKET_PREFIX + ticket,
                member.getId() + "|" + provider.id(),
                properties.getBindingTicketTtl());
        return new SocialBindingStartResponse(
                provider.id(),
                provider.label(),
                "READY",
                authorizationUrl(provider, ticket));
    }

    public String prepareAuthorization(
            String providerId,
            String bindingTicket,
            HttpSession session) {
        SocialProvider provider = requireEnabledProvider(providerId);
        session.setAttribute(SESSION_FLOW, FLOW_LOGIN);
        session.removeAttribute(SESSION_MEMBER_ID);

        if (StringUtils.hasText(bindingTicket)) {
            String payload = redisTemplate.opsForValue()
                    .getAndDelete(BINDING_TICKET_PREFIX + bindingTicket);
            if (!StringUtils.hasText(payload)) {
                throw new SocialOAuthException(
                        HttpStatus.UNAUTHORIZED,
                        "Social binding ticket is invalid or expired");
            }
            String[] parts = payload.split("\\|", 2);
            if (parts.length != 2 || !provider.id().equals(parts[1])) {
                throw new SocialOAuthException(
                        HttpStatus.BAD_REQUEST,
                        "Social binding provider does not match");
            }
            try {
                session.setAttribute(SESSION_MEMBER_ID, Long.parseLong(parts[0]));
            } catch (NumberFormatException ex) {
                throw new SocialOAuthException(
                        HttpStatus.BAD_REQUEST,
                        "Social binding ticket is malformed");
            }
            session.setAttribute(SESSION_FLOW, FLOW_BIND);
        }

        return "/api/v1/auth/oauth2/authorization/" + provider.id();
    }

    @Transactional
    public String completeOAuthLogin(
            OAuth2AuthenticationToken authentication,
            HttpSession session) {
        if (session == null) {
            throw new SocialOAuthException(
                    HttpStatus.UNAUTHORIZED,
                    "Social login session is missing or expired");
        }
        SocialProvider provider = SocialProvider.fromId(
                authentication.getAuthorizedClientRegistrationId());
        Map<String, Object> attributes = authentication.getPrincipal().getAttributes();
        String subject = stringAttribute(attributes, "sub");
        if (!StringUtils.hasText(subject)) {
            throw new SocialOAuthException(
                    HttpStatus.UNAUTHORIZED,
                    "OAuth provider did not return a stable subject identifier");
        }

        if (FLOW_BIND.equals(session.getAttribute(SESSION_FLOW))) {
            Long memberId = (Long) session.getAttribute(SESSION_MEMBER_ID);
            if (memberId == null) {
                throw new SocialOAuthException(
                        HttpStatus.UNAUTHORIZED,
                        "Social binding session is missing or expired");
            }
            bindAccount(memberId, provider, subject, attributes);
            invalidateQuietly(session);
            return frontendUrl(
                    "/profile/social-bindings/" + provider.id(),
                    "status",
                    "success");
        }

        MemberSocialAccount account = socialAccountRepository
                .findByProviderAndProviderSubject(provider.id(), subject)
                .orElseThrow(() -> new SocialOAuthException(
                        HttpStatus.UNAUTHORIZED,
                        provider.label() + " 帳戶尚未綁定，請先使用帳號密碼登入後完成綁定"));
        updateProviderProfile(account, attributes);
        socialAccountRepository.save(account);

        LoginResponse login = authService.loginMember(account.getMember());
        String ticket = UUID.randomUUID().toString();
        redisTemplate.opsForValue().set(
                LOGIN_TICKET_PREFIX + ticket,
                serializeLogin(login),
                properties.getLoginTicketTtl());
        invalidateQuietly(session);
        return frontendUrl("/auth/callback", "ticket", ticket);
    }

    public LoginResponse exchangeLoginTicket(String ticket) {
        String payload = redisTemplate.opsForValue().getAndDelete(LOGIN_TICKET_PREFIX + ticket);
        if (!StringUtils.hasText(payload)) {
            throw new SocialOAuthException(
                    HttpStatus.UNAUTHORIZED,
                    "Social login ticket is invalid or expired");
        }
        try {
            SocialLoginTicketPayload parsed =
                    objectMapper.readValue(payload, SocialLoginTicketPayload.class);
            return new LoginResponse(parsed.accessToken(), parsed.refreshToken());
        } catch (JsonProcessingException ex) {
            throw new SocialOAuthException(
                    HttpStatus.UNAUTHORIZED,
                    "Social login ticket is invalid");
        }
    }

    public String failureRedirect(String message) {
        return frontendUrl(
                "/auth/callback",
                "error",
                StringUtils.hasText(message) ? message : "第三方登入失敗");
    }

    private void bindAccount(
            Long memberId,
            SocialProvider provider,
            String subject,
            Map<String, Object> attributes) {
        Member member = memberRepository.findById(memberId)
                .orElseThrow(() -> new MemberNotFoundException("Member not found: " + memberId));
        socialAccountRepository
                .findByProviderAndProviderSubject(provider.id(), subject)
                .filter(existing -> !existing.getMember().getId().equals(memberId))
                .ifPresent(existing -> {
                    throw new SocialOAuthException(
                            HttpStatus.CONFLICT,
                            "This social account is already bound to another member");
                });

        MemberSocialAccount account = socialAccountRepository
                .findByMemberIdAndProvider(memberId, provider.id())
                .orElseGet(MemberSocialAccount::new);
        account.setMember(member);
        account.setProvider(provider.id());
        account.setProviderSubject(subject);
        updateProviderProfile(account, attributes);
        socialAccountRepository.save(account);
    }

    private void updateProviderProfile(
            MemberSocialAccount account,
            Map<String, Object> attributes) {
        account.setEmail(stringAttribute(attributes, "email"));
        account.setDisplayName(stringAttribute(attributes, "name"));
        String avatar = stringAttribute(attributes, "picture");
        if (!StringUtils.hasText(avatar)) {
            avatar = stringAttribute(attributes, "pictureUrl");
        }
        account.setAvatarUrl(avatar);
    }

    private SocialProvider requireEnabledProvider(String providerId) {
        SocialProvider provider = SocialProvider.fromId(providerId);
        if (!properties.isEnabled(provider)) {
            throw new SocialOAuthException(
                    HttpStatus.SERVICE_UNAVAILABLE,
                    provider.label() + " login is not configured");
        }
        return provider;
    }

    private String authorizationUrl(SocialProvider provider, String bindingTicket) {
        UriComponentsBuilder builder = UriComponentsBuilder
                .fromPath("/api/v1/auth/social/{provider}/authorize");
        if (StringUtils.hasText(bindingTicket)) {
            builder.queryParam("bindingTicket", bindingTicket);
        }
        return builder.buildAndExpand(provider.id()).toUriString();
    }

    private String frontendUrl(String path, String parameter, String value) {
        String base = properties.getFrontendBaseUrl().replaceAll("/+$", "");
        return UriComponentsBuilder.fromUriString(base)
                .path(path)
                .queryParam(parameter, value)
                .build()
                .encode()
                .toUriString();
    }

    private String serializeLogin(LoginResponse login) {
        try {
            return objectMapper.writeValueAsString(new SocialLoginTicketPayload(
                    login.getAccessToken(),
                    login.getRefreshToken()));
        } catch (JsonProcessingException ex) {
            throw new IllegalStateException("Unable to create social login ticket", ex);
        }
    }

    private String stringAttribute(Map<String, Object> attributes, String name) {
        Object value = attributes.get(name);
        return value != null ? String.valueOf(value) : null;
    }

    private void invalidateQuietly(HttpSession session) {
        try {
            session.invalidate();
        } catch (IllegalStateException ignored) {
            // Session may already have been invalidated by the security filter chain.
        }
    }

    private record SocialLoginTicketPayload(String accessToken, String refreshToken) {
    }
}
