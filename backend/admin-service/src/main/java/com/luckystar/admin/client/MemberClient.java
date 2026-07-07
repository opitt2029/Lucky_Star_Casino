package com.luckystar.admin.client;

import java.util.Map;
import org.springframework.stereotype.Component;
import org.springframework.web.client.ResourceAccessException;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientResponseException;

/**
 * 呼叫 member-service 內部 API 的客戶端（T-051 補完）。
 *
 * <p>停用/啟用玩家時把狀態持久化寫入 member DB 的 {@code members.status}
 * （{@code PATCH /internal/members/{id}/status}）。Redis 封鎖標記只負責「即時生效」，
 * DB status 才是真相來源——Redis 資料清空後仍由 member 登入檢查擋住停用玩家。
 *
 * <p>身分驗證由建構 {@code RestClient} 時注入的 {@code X-Internal-Secret} 預設 header 完成
 * （見 {@code MemberClientConfig}），走服務直連、不經 gateway。
 */
@Component
public class MemberClient {

    private final RestClient memberRestClient;

    public MemberClient(RestClient memberRestClient) {
        this.memberRestClient = memberRestClient;
    }

    /** 更新會員帳號狀態：enabled=true → ACTIVE、false → DISABLED。失敗丟 {@link MemberServiceException}。 */
    public void updateStatus(long playerId, boolean enabled) {
        try {
            memberRestClient.patch()
                    .uri("/internal/members/{id}/status", playerId)
                    .body(Map.of("enabled", enabled))
                    .retrieve()
                    .toBodilessEntity();
        } catch (RestClientResponseException ex) {
            throw new MemberServiceException(
                    "member-service 回應異常（HTTP " + ex.getStatusCode().value() + "）");
        } catch (ResourceAccessException ex) {
            throw new MemberServiceException("無法連線 member-service", ex);
        }
    }
}
