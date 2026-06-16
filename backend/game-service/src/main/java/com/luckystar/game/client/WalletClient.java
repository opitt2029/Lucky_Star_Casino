package com.luckystar.game.client;

import com.luckystar.game.client.dto.WalletCreditRequest;
import com.luckystar.game.client.dto.WalletCreditResponse;
import com.luckystar.game.client.dto.WalletDebitRequest;
import com.luckystar.game.client.dto.WalletDebitResponse;
import com.luckystar.game.client.dto.WalletEnvelope;
import com.luckystar.game.exception.InsufficientBalanceException;
import com.luckystar.game.exception.WalletUnavailableException;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.client.ResourceAccessException;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientResponseException;

/**
 * 呼叫 wallet-service 內部帳務 API 的客戶端（T-032）。
 *
 * <p>下注流程需要與 wallet 同步互動：先 {@link #debit} 扣下注，命中時再 {@link #credit} 派彩。
 * 兩者皆帶冪等鍵，wallet 端以 {@code idempotency_key} UNIQUE 保證同 key 只生效一次，
 * 故重試安全（ADR：帳務操作冪等 + 樂觀鎖）。
 *
 * <p>身分驗證由建構 {@code RestClient} 時注入的 {@code X-Internal-Secret} 預設 header 完成
 * （見 {@code WalletClientConfig}）。
 *
 * <p>錯誤對應：
 * <ul>
 *   <li>HTTP 422 → {@link InsufficientBalanceException}（餘額不足，下注時可能發生）</li>
 *   <li>連線失敗 / 其他非 2xx / 回應格式異常 → {@link WalletUnavailableException}</li>
 * </ul>
 */
@Component
public class WalletClient {

    private final RestClient walletRestClient;

    public WalletClient(RestClient walletRestClient) {
        this.walletRestClient = walletRestClient;
    }

    /** 扣款（下注）。 */
    public WalletDebitResponse debit(long playerId, long amount, String idempotencyKey, String referenceId) {
        WalletDebitRequest body = new WalletDebitRequest(playerId, amount, idempotencyKey, referenceId);
        WalletEnvelope<WalletDebitResponse> env = post(
                "/internal/wallet/debit", body,
                new ParameterizedTypeReference<WalletEnvelope<WalletDebitResponse>>() {});
        return env.data();
    }

    /** 派彩（入帳）。{@code subType} 固定為 {@code "WIN"}。 */
    public WalletCreditResponse credit(long playerId, long amount, String idempotencyKey, String referenceId) {
        WalletCreditRequest body = new WalletCreditRequest(
                playerId, amount, "WIN", idempotencyKey, referenceId, 0L);
        WalletEnvelope<WalletCreditResponse> env = post(
                "/internal/wallet/credit", body,
                new ParameterizedTypeReference<WalletEnvelope<WalletCreditResponse>>() {});
        return env.data();
    }

    private <T> WalletEnvelope<T> post(String path, Object body, ParameterizedTypeReference<WalletEnvelope<T>> typeRef) {
        try {
            WalletEnvelope<T> env = walletRestClient.post()
                    .uri(path)
                    .body(body)
                    .retrieve()
                    .body(typeRef);
            if (env == null || !env.success() || env.data() == null) {
                throw new WalletUnavailableException("錢包服務回應格式異常: " + path);
            }
            return env;
        } catch (RestClientResponseException ex) {
            if (ex.getStatusCode().value() == HttpStatus.UNPROCESSABLE_ENTITY.value()) {
                throw new InsufficientBalanceException("星幣餘額不足");
            }
            throw new WalletUnavailableException(
                    "錢包服務回應異常（HTTP " + ex.getStatusCode().value() + "）: " + path);
        } catch (ResourceAccessException ex) {
            throw new WalletUnavailableException("無法連線錢包服務: " + path, ex);
        }
    }
}
