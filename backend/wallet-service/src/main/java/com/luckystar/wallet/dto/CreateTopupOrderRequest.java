package com.luckystar.wallet.dto;

import jakarta.validation.constraints.NotBlank;
import lombok.Data;

/** 建立加值訂單請求。玩家身分走 X-User-Id header，不由 body 指定，避免冒名建單。 */
@Data
public class CreateTopupOrderRequest {

    /** 方案代號（P100 / P500 / P1000）。 */
    @NotBlank
    private String packageId;
}
