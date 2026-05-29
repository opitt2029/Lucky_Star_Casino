package com.luckystar.gateway.filter;

/**
 * Gateway 全域 filter 執行順序常數。
 *
 * <p>Spring Cloud Gateway 的 GlobalFilter / Ordered.getOrder() 採「數字越小越早執行」語意。
 * 集中定義於此類別，避免不同 filter 之間 order 衝突或順序不明。</p>
 *
 * <pre>
 *   執行鏈：
 *     RATE_LIMIT (-200)        ← 最早，先擋下暴力請求避免後續驗證浪費資源
 *       ↓
 *     JWT_AUTHENTICATION (-100) ← 驗 JWT + 黑名單，注入 X-User-Id / X-User-Role header
 *       ↓
 *     PLAYER_RATE_LIMIT (-50)  ← 依 X-User-Id 做每玩家滑動視窗限流
 *       ↓
 *     (Gateway 內建路由轉發 Filter, order ≥ 0)
 * </pre>
 */
public final class FilterOrder {

    /** 速率限制：最早執行，攔截暴力請求避免後續資源浪費。 */
    public static final int RATE_LIMIT = -200;

    /** JWT 驗證：驗簽、查黑名單、注入下游 header。 */
    public static final int JWT_AUTHENTICATION = -100;

    /** 每玩家速率限制：JWT 驗證完成後執行，以 X-User-Id 為計數金鑰。 */
    public static final int PLAYER_RATE_LIMIT = -50;

    private FilterOrder() {
        // utility class
    }
}
