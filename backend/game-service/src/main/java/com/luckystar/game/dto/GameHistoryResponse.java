package com.luckystar.game.dto;

import java.util.List;
import lombok.Builder;
import lombok.Data;

/**
 * 遊戲紀錄分頁回應。欄位形狀與前端錢包交易紀錄一致（{@code items / total / page / pageSize}），
 * 方便前端沿用相同的分頁元件。
 */
@Data
@Builder
public class GameHistoryResponse {

    /** 本頁注單清單（依時間由新到舊）。 */
    private List<GameRecordView> items;

    /** 符合條件的注單總數。 */
    private long total;

    /** 目前頁碼（1-based）。 */
    private int page;

    /** 每頁筆數。 */
    private int pageSize;
}
