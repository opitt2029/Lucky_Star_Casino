package com.luckystar.member.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.luckystar.member.config.SocialOAuthProperties;
import com.luckystar.member.dto.LoginResponse;
import com.luckystar.member.entity.Member;
import com.luckystar.member.entity.MemberSocialAccount;
import com.luckystar.member.exception.SocialOAuthException;
import com.luckystar.member.repository.MemberRepository;
import com.luckystar.member.repository.MemberSocialAccountRepository;
import jakarta.servlet.http.HttpSession;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.ValueOperations;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.oauth2.client.authentication.OAuth2AuthenticationToken;
import org.springframework.security.oauth2.core.user.DefaultOAuth2User;

import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class SocialAuthServiceTest {

    @Mock
    private MemberRepository memberRepository;
    @Mock
    private MemberSocialAccountRepository socialAccountRepository;
    @Mock
    private AuthService authService;
    @Mock
    private StringRedisTemplate redisTemplate;
    @Mock
    private ValueOperations<String, String> valueOperations;
    @Mock
    private HttpSession session;

    private SocialAuthService socialAuthService;
    private SocialOAuthProperties properties;

    @BeforeEach
    void setUp() {
        properties = new SocialOAuthProperties();
        properties.setFrontendBaseUrl("http://localhost:5173");
        properties.setBindingTicketTtl(Duration.ofMinutes(5));
        properties.setLoginTicketTtl(Duration.ofMinutes(2));
        SocialOAuthProperties.Provider google = new SocialOAuthProperties.Provider();
        google.setEnabled(true);
        properties.setProviders(Map.of("google", google));
        org.mockito.Mockito.lenient()
                .when(redisTemplate.opsForValue())
                .thenReturn(valueOperations);
        socialAuthService = new SocialAuthService(
                memberRepository,
                socialAccountRepository,
                authService,
                redisTemplate,
                new ObjectMapper(),
                properties);
    }

    @Test
    void startLogin_enabledProvider_returnsGatewayAuthorizationUrl() {
        var result = socialAuthService.startLogin("google");

        assertThat(result.getProvider()).isEqualTo("google");
        assertThat(result.getAuthorizationUrl())
                .isEqualTo("/api/v1/auth/social/google/authorize");
    }

    @Test
    void startLogin_disabledProvider_isRejected() {
        assertThatThrownBy(() -> socialAuthService.startLogin("line"))
                .isInstanceOf(SocialOAuthException.class)
                .hasMessageContaining("not configured");
    }

    @Test
    void startBinding_createsShortLivedOneTimeTicket() {
        Member member = member(7L);
        when(memberRepository.findById(7L)).thenReturn(Optional.of(member));

        var result = socialAuthService.startBinding(7L, "google");

        assertThat(result.getAuthorizationUrl()).contains("bindingTicket=");
        verify(valueOperations).set(
                org.mockito.ArgumentMatchers.startsWith("oauth:binding-ticket:"),
                eq("7|google"),
                eq(Duration.ofMinutes(5)));
    }

    @Test
    void exchangeLoginTicket_isOneTimeAndReturnsJwtPair() throws Exception {
        String payload = new ObjectMapper().writeValueAsString(Map.of(
                "accessToken", "access-token",
                "refreshToken", "refresh-token"));
        when(valueOperations.getAndDelete("oauth:login-ticket:ticket-1"))
                .thenReturn(payload);

        LoginResponse result = socialAuthService.exchangeLoginTicket("ticket-1");

        assertThat(result.getAccessToken()).isEqualTo("access-token");
        assertThat(result.getRefreshToken()).isEqualTo("refresh-token");
    }

    @Test
    void completeOAuthLogin_requiresExistingBindingAndCreatesTicket() {
        Member member = member(7L);
        MemberSocialAccount account = new MemberSocialAccount();
        account.setMember(member);
        account.setProvider("google");
        account.setProviderSubject("google-sub");
        when(session.getAttribute("socialOAuthFlow")).thenReturn("LOGIN");
        when(socialAccountRepository.findByProviderAndProviderSubject("google", "google-sub"))
                .thenReturn(Optional.of(account));
        when(authService.loginMember(member))
                .thenReturn(new LoginResponse("access-token", "refresh-token"));

        String redirect = socialAuthService.completeOAuthLogin(oauthToken(), session);

        assertThat(redirect).startsWith("http://localhost:5173/auth/callback?ticket=");
        verify(valueOperations).set(
                org.mockito.ArgumentMatchers.startsWith("oauth:login-ticket:"),
                anyString(),
                eq(Duration.ofMinutes(2)));
        verify(session).invalidate();
    }

    @Test
    void completeOAuthBinding_persistsVerifiedProviderSubject() {
        Member member = member(7L);
        when(session.getAttribute("socialOAuthFlow")).thenReturn("BIND");
        when(session.getAttribute("socialOAuthMemberId")).thenReturn(7L);
        when(memberRepository.findById(7L)).thenReturn(Optional.of(member));
        when(socialAccountRepository.findByProviderAndProviderSubject("google", "google-sub"))
                .thenReturn(Optional.empty());
        when(socialAccountRepository.findByMemberIdAndProvider(7L, "google"))
                .thenReturn(Optional.empty());

        String redirect = socialAuthService.completeOAuthLogin(oauthToken(), session);

        assertThat(redirect)
                .isEqualTo("http://localhost:5173/profile/social-bindings/google?status=success");
        verify(socialAccountRepository).save(org.mockito.ArgumentMatchers.argThat(account ->
                account.getMember() == member
                        && "google".equals(account.getProvider())
                        && "google-sub".equals(account.getProviderSubject())));
    }

    private OAuth2AuthenticationToken oauthToken() {
        var principal = new DefaultOAuth2User(
                List.of(new SimpleGrantedAuthority("ROLE_USER")),
                Map.of(
                        "sub", "google-sub",
                        "email", "player@example.com",
                        "name", "Lucky Player"),
                "sub");
        return new OAuth2AuthenticationToken(
                principal,
                principal.getAuthorities(),
                "google");
    }

    private Member member(Long id) {
        Member member = new Member();
        member.setId(id);
        member.setUsername("player" + id);
        member.setEmail("player" + id + "@example.com");
        member.setNickname("Player " + id);
        member.setPasswordHash("hash");
        member.setRole("PLAYER");
        member.setStatus("ACTIVE");
        return member;
    }
}
