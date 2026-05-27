package com.luckystar.member.security;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.test.util.ReflectionTestUtils;

import static org.junit.jupiter.api.Assertions.*;

@ExtendWith(MockitoExtension.class)
class InternalSecretFilterTest {

    private InternalSecretFilter filter;

    @BeforeEach
    void setUp() {
        filter = new InternalSecretFilter();
        ReflectionTestUtils.setField(filter, "internalSecret", "test-secret");
    }

    // ── Test 1: 非 /internal/** 路徑直接放行 ──────────────────────────────────

    @Test
    void nonInternalPath_passesThrough() throws Exception {
        MockHttpServletRequest request = new MockHttpServletRequest("POST", "/api/v1/auth/login");
        MockHttpServletResponse response = new MockHttpServletResponse();
        MockFilterChain filterChain = new MockFilterChain();

        filter.doFilter(request, response, filterChain);

        // filterChain.doFilter 被呼叫後，getRequest() 會有值
        assertNotNull(filterChain.getRequest(), "filterChain.doFilter 應該被呼叫一次");
        assertNotEquals(401, response.getStatus());
    }

    // ── Test 2: /internal/** + 正確 secret → 放行 ────────────────────────────

    @Test
    void internalPath_validSecret_passesThrough() throws Exception {
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/internal/wallet/balance");
        request.addHeader("X-Internal-Secret", "test-secret");
        MockHttpServletResponse response = new MockHttpServletResponse();
        MockFilterChain filterChain = new MockFilterChain();

        filter.doFilter(request, response, filterChain);

        assertNotNull(filterChain.getRequest(), "filterChain.doFilter 應該被呼叫一次");
        assertNotEquals(401, response.getStatus());
    }

    // ── Test 3: /internal/** + 錯誤 secret → 401，不繼續 ────────────────────

    @Test
    void internalPath_wrongSecret_returns401() throws Exception {
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/internal/wallet/balance");
        request.addHeader("X-Internal-Secret", "wrong");
        MockHttpServletResponse response = new MockHttpServletResponse();
        MockFilterChain filterChain = new MockFilterChain();

        filter.doFilter(request, response, filterChain);

        assertNull(filterChain.getRequest(), "filterChain.doFilter 不應被呼叫");
        assertEquals(401, response.getStatus());
    }

    // ── Test 4: /internal/** + 缺少 header → 401，不繼續 ────────────────────

    @Test
    void internalPath_missingHeader_returns401() throws Exception {
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/internal/wallet/balance");
        MockHttpServletResponse response = new MockHttpServletResponse();
        MockFilterChain filterChain = new MockFilterChain();

        filter.doFilter(request, response, filterChain);

        assertNull(filterChain.getRequest(), "filterChain.doFilter 不應被呼叫");
        assertEquals(401, response.getStatus());
    }
}
