package com.luckystar.game.dto;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.PositiveOrZero;
import jakarta.validation.constraints.Size;
import lombok.Data;

/**
 * 百家樂下注請求（T-035）。對應 {@code POST /api/v1/game/baccarat/bet} 的 body。
 *
 * <p>支援一局多區押注：閒（player）／莊（banker）／和（tie）可同時下注，各區金額皆為非負整數。
 * 三區總額的下限/上限與是否至少押一區，由 service 層驗證（見 {@code BaccaratService}）。
 * 玩家身分由 gateway 注入的 {@code X-User-Id} header 決定。
 */
@Data
public class BaccaratBetRequest {

    /** 押閒金額（星幣，非負；不押填 0 或省略）。 */
    @PositiveOrZero(message = "押注金額不可為負")
    @Max(value = 5000, message = "單區下注上限 5,000 星幣")
    private Long player;

    /** 押莊金額（星幣，非負）。 */
    @PositiveOrZero(message = "押注金額不可為負")
    @Max(value = 5000, message = "單區下注上限 5,000 星幣")
    private Long banker;

    /** 押和金額（星幣，非負）。 */
    @PositiveOrZero(message = "押注金額不可為負")
    @Max(value = 5000, message = "單區下注上限 5,000 星幣")
    private Long tie;

    /** 玩家自訂 client seed（選填）；未提供時由伺服器產生。 */
    @Size(max = 200, message = "clientSeed 長度上限 200")
    private String clientSeed;

    /** 幸運值是否已滿（true = 本局保底必中）；前端在 fortune.full 時傳入。 */
    private Boolean fortuneReady;

    public boolean isFortuneFull() {
        return Boolean.TRUE.equals(fortuneReady);
    }
}
