package com.luckystar.wallet.common;

import org.springframework.data.domain.Page;

import java.util.List;
import java.util.function.Function;

/**
 * 穩定的分頁回傳格式。
 *
 * <p>不直接序列化 Spring Data 的 {@link Page}（其 JSON 結構不穩定、Boot 3 已對其發出
 * 序列化警告），改用此固定 schema：{@code content} + 分頁中繼資料，避免前端依賴內部結構。
 *
 * @param content       當頁資料
 * @param page          目前頁碼（0-based）
 * @param size          每頁筆數
 * @param totalElements 符合條件的總筆數
 * @param totalPages    總頁數
 */
public record PagedResponse<T>(
        List<T> content,
        int page,
        int size,
        long totalElements,
        int totalPages) {

    /** 由 Spring Data {@link Page} 與元素轉換函式建構，順手把 entity 映射成 DTO。 */
    public static <E, T> PagedResponse<T> from(Page<E> source, Function<E, T> mapper) {
        return new PagedResponse<>(
                source.getContent().stream().map(mapper).toList(),
                source.getNumber(),
                source.getSize(),
                source.getTotalElements(),
                source.getTotalPages());
    }
}
