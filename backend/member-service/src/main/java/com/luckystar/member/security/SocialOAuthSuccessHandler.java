package com.luckystar.member.security;

import com.luckystar.member.exception.SocialOAuthException;
import com.luckystar.member.service.SocialAuthService;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.security.core.Authentication;
import org.springframework.security.oauth2.client.authentication.OAuth2AuthenticationToken;
import org.springframework.security.web.authentication.AuthenticationSuccessHandler;
import org.springframework.stereotype.Component;

import java.io.IOException;

@Slf4j
@Component
@RequiredArgsConstructor
public class SocialOAuthSuccessHandler implements AuthenticationSuccessHandler {

    private final SocialAuthService socialAuthService;

    @Override
    public void onAuthenticationSuccess(
            HttpServletRequest request,
            HttpServletResponse response,
            Authentication authentication) throws IOException, ServletException {
        if (!(authentication instanceof OAuth2AuthenticationToken oauthToken)) {
            response.sendRedirect(socialAuthService.failureRedirect("Invalid OAuth authentication"));
            return;
        }
        try {
            String target = socialAuthService.completeOAuthLogin(
                    oauthToken,
                    request.getSession(false));
            response.sendRedirect(target);
        } catch (SocialOAuthException ex) {
            log.warn("Social OAuth completion rejected: {}", ex.getMessage());
            response.sendRedirect(socialAuthService.failureRedirect(ex.getMessage()));
        } catch (Exception ex) {
            log.error("Social OAuth completion failed", ex);
            response.sendRedirect(socialAuthService.failureRedirect("第三方登入暫時無法完成"));
        }
    }
}
