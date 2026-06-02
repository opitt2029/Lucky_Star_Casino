package com.luckystar.game.client;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.hamcrest.Matchers.endsWith;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.method;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withServerError;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withStatus;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;

import com.luckystar.game.client.dto.WalletCreditResponse;
import com.luckystar.game.client.dto.WalletDebitResponse;
import com.luckystar.game.exception.InsufficientBalanceException;
import com.luckystar.game.exception.WalletUnavailableException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestClient;

/** {@link WalletClient} 測試：以 MockRestServiceServer 模擬 wallet-service 的回應與錯誤狀態。 */
class WalletClientTest {

    private MockRestServiceServer server;
    private WalletClient walletClient;

    @BeforeEach
    void setUp() {
        RestClient.Builder builder = RestClient.builder().baseUrl("http://wallet");
        server = MockRestServiceServer.bindTo(builder).build();
        walletClient = new WalletClient(builder.build());
    }

    @Test
    @DisplayName("debit 成功：解析 data.balanceAfter")
    void debit_success() {
        server.expect(requestTo(endsWith("/internal/wallet/debit")))
                .andExpect(method(HttpMethod.POST))
                .andRespond(withSuccess(
                        "{\"success\":true,\"data\":{\"transactionId\":1,\"playerId\":42,"
                                + "\"amount\":100,\"balanceBefore\":10000,\"balanceAfter\":9900,"
                                + "\"idempotent\":false},\"message\":null}",
                        MediaType.APPLICATION_JSON));

        WalletDebitResponse res = walletClient.debit(42L, 100L, "key-1", "round-1");

        assertEquals(9900L, res.balanceAfter());
        server.verify();
    }

    @Test
    @DisplayName("credit 成功：解析 data.balanceAfter / frozenAfter")
    void credit_success() {
        server.expect(requestTo(endsWith("/internal/wallet/credit")))
                .andExpect(method(HttpMethod.POST))
                .andRespond(withSuccess(
                        "{\"success\":true,\"data\":{\"transactionId\":2,\"playerId\":42,"
                                + "\"amount\":500,\"balanceBefore\":9900,\"balanceAfter\":10400,"
                                + "\"frozenAfter\":0,\"idempotent\":false},\"message\":null}",
                        MediaType.APPLICATION_JSON));

        WalletCreditResponse res = walletClient.credit(42L, 500L, "key-win", "round-1");

        assertEquals(10400L, res.balanceAfter());
        assertEquals(0L, res.frozenAfter());
        server.verify();
    }

    @Test
    @DisplayName("HTTP 422 → InsufficientBalanceException")
    void debit_422_insufficientBalance() {
        server.expect(requestTo(endsWith("/internal/wallet/debit")))
                .andRespond(withStatus(HttpStatus.UNPROCESSABLE_ENTITY)
                        .body("{\"success\":false,\"data\":null,\"message\":\"Insufficient balance\"}")
                        .contentType(MediaType.APPLICATION_JSON));

        assertThrows(InsufficientBalanceException.class,
                () -> walletClient.debit(42L, 100L, "key-1", "round-1"));
    }

    @Test
    @DisplayName("HTTP 5xx → WalletUnavailableException")
    void debit_serverError_walletUnavailable() {
        server.expect(requestTo(endsWith("/internal/wallet/debit")))
                .andRespond(withServerError());

        assertThrows(WalletUnavailableException.class,
                () -> walletClient.debit(42L, 100L, "key-1", "round-1"));
    }
}
