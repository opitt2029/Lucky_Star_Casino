package com.luckystar.game.client.dto;

/**
 * wallet-service 統一回應封包的反序列化載體 {@code { success, data, message }}。
 *
 * @param <T> data 的型別
 */
public record WalletEnvelope<T>(boolean success, T data, String message) {
}
