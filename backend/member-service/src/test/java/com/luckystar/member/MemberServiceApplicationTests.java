package com.luckystar.member;

import com.luckystar.member.config.SecurityConfig;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.ApplicationContext;
import org.springframework.security.authentication.AuthenticationManager;
import org.springframework.security.oauth2.jose.jws.MacAlgorithm;
import org.springframework.security.oauth2.jose.jws.SignatureAlgorithm;

import static org.junit.jupiter.api.Assertions.assertEquals;

@SpringBootTest
class MemberServiceApplicationTests {

    @Autowired
    private ApplicationContext applicationContext;

    @Test
    void contextLoads() {
    }

    @Test
    void oauthLogin_doesNotPublishSelfDelegatingAuthenticationManager() {
        assertEquals(
                0,
                applicationContext.getBeanNamesForType(AuthenticationManager.class).length);
    }

    @Test
    void oauthLogin_lineUsesHs256IdTokenValidation() {
        assertEquals(MacAlgorithm.HS256, SecurityConfig.resolveIdTokenAlgorithm("line"));
    }

    @Test
    void oauthLogin_otherProvidersUseRs256IdTokenValidation() {
        assertEquals(SignatureAlgorithm.RS256, SecurityConfig.resolveIdTokenAlgorithm("google"));
    }
}
