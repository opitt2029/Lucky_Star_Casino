package com.luckystar.game.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.util.List;
import lombok.Data;

/**
 * 捕魚機批次射擊請求。對應 {@code POST /api/v1/game/fishing/{sessionId}/shots}。
 *
 * <p>前端每約 1 秒（或每 10 發）flush 一批；每發子彈帶嚴格遞增的 {@code shotSeq}
 * （= Provably Fair nonce），後端逐發判定並只動局內餘額。
 */
@Data
public class FishingShotsRequest {

    @NotEmpty(message = "shots 不可為空")
    @Size(max = 30, message = "單批最多 30 發")
    @Valid
    private List<Shot> shots;

    /** 幸運值是否已滿（true = 本批第一發保底命中）；前端在 fortune.full 時傳入。 */
    private Boolean fortuneReady;

    public boolean isFortuneFull() {
        return Boolean.TRUE.equals(fortuneReady);
    }

    /** 單發子彈。 */
    @Data
    public static class Shot {

        /** 子彈序號（場次內嚴格遞增，= Provably Fair nonce）。 */
        @NotNull
        @Min(value = 1, message = "shotSeq 由 1 起算")
        private Long shotSeq;

        /** 單發下注額（須符合炮台等級允許值）。 */
        @NotNull
        @Min(value = 1, message = "betPerShot 必須為正")
        @Max(value = 1000, message = "betPerShot 上限 1,000")
        private Long betPerShot;

        /** 目標魚種代碼（FishSpecies 名稱）。 */
        @NotBlank(message = "缺少魚種代碼 fishType")
        private String fishType;
    }
}
