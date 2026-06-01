package com.luckystar.wallet.exception;

/**
 * 鑽石錢包不存在（T-102）。理論上開戶（T-101）已為每位玩家建立 {@code diamond_wallets}，
 * 但若兌換時查無鑽石錢包（例如開戶事件遺失），回 404 而非靜默建立。
 */
public class DiamondWalletNotFoundException extends RuntimeException {
    public DiamondWalletNotFoundException(String message) {
        super(message);
    }
}
