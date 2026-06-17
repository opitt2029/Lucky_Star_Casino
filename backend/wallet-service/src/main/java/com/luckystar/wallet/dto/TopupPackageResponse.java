package com.luckystar.wallet.dto;

/**
 * 加值方案（提供前端列出可選項目）。
 *
 * @param packageId  方案代號（P100 / P500 / P1000）
 * @param priceLabel 顯示用售價（NT$100）
 * @param amount     入帳星幣數
 */
public record TopupPackageResponse(String packageId, String priceLabel, long amount) {
}
