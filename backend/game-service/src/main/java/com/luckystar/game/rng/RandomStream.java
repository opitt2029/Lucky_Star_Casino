package com.luckystar.game.rng;

import java.nio.charset.StandardCharsets;

/**
 * 由 {@code (serverSeed, clientSeed, nonce)} 推導出的確定性隨機數串流（T-030）。
 *
 * <p>核心演算法為 {@code SHA-256(serverSeed:clientSeed:nonce:block)}：每個 32-byte
 * 雜湊區塊提供 256 bits 的隨機位元組；當位元組用罄時，遞增 {@code block} 索引再雜湊一次，
 * 即可在單局內延伸出任意長度的隨機序列（例如老虎機多輪盤面、百家樂多張牌）。
 *
 * <p>相同三元組必產出相同序列，這正是「可驗證公平」的關鍵。本類別<b>非執行緒安全</b>，
 * 一條串流應只在單一下注運算流程中使用。
 */
public final class RandomStream {

    private static final int BLOCK_SIZE = 32; // SHA-256 輸出位元組數

    private final String serverSeed;
    private final String clientSeed;
    private final long nonce;

    /** 目前區塊的位元組緩衝。 */
    private byte[] buffer;
    /** 緩衝內下一個可讀位置。 */
    private int position;
    /** 下一個待計算的區塊索引。 */
    private long nextBlock;

    RandomStream(String serverSeed, String clientSeed, long nonce) {
        if (serverSeed == null || serverSeed.isEmpty()) {
            throw new IllegalArgumentException("serverSeed 不可為空");
        }
        if (clientSeed == null || clientSeed.isEmpty()) {
            throw new IllegalArgumentException("clientSeed 不可為空");
        }
        this.serverSeed = serverSeed;
        this.clientSeed = clientSeed;
        this.nonce = nonce;
        this.buffer = new byte[0];
        this.position = 0;
        this.nextBlock = 0;
    }

    /**
     * 取得下一個 {@code [0, 256)} 的隨機位元組。
     */
    public int nextByte() {
        if (position >= buffer.length) {
            buffer = ProvablyFairRng.sha256(blockMessage(serverSeed, clientSeed, nonce, nextBlock));
            nextBlock++;
            position = 0;
        }
        return buffer[position++] & 0xFF;
    }

    /**
     * 取得下一個 {@code [0.0, 1.0)} 的均勻分布浮點數。
     *
     * <p>取連續 4 個位元組組成 big-endian 的無號 32-bit 整數，再除以 {@code 2^32}。
     */
    public double nextDouble() {
        long u = 0L;
        for (int i = 0; i < 4; i++) {
            u = (u << 8) | nextByte();
        }
        return u / 4294967296.0d; // 2^32
    }

    /**
     * 取得下一個 {@code [0, bound)} 的均勻分布整數。
     *
     * <p>以拒絕取樣（rejection sampling）消除取模偏差，確保各值機率相等。
     *
     * @param bound 上界（不含），須為正數
     */
    public int nextInt(int bound) {
        if (bound <= 0) {
            throw new IllegalArgumentException("bound 必須為正數，實際為 " + bound);
        }
        // 以 4 個位元組構成 [0, 2^32) 的值；丟棄落在不可整除尾段者以避免偏差。
        long range = 1L << 32;
        long limit = range - (range % bound);
        while (true) {
            long u = 0L;
            for (int i = 0; i < 4; i++) {
                u = (u << 8) | nextByte();
            }
            if (u < limit) {
                return (int) (u % bound);
            }
        }
    }

    /**
     * 取得一組 {@code [0, bound)} 的隨機整數（依序自串流取出）。
     *
     * @param count 數量，須為非負
     * @param bound 上界（不含），須為正數
     */
    public int[] nextInts(int count, int bound) {
        if (count < 0) {
            throw new IllegalArgumentException("count 不可為負，實際為 " + count);
        }
        int[] result = new int[count];
        for (int i = 0; i < count; i++) {
            result[i] = nextInt(bound);
        }
        return result;
    }

    /**
     * 組出第 {@code block} 個雜湊區塊的輸入訊息：{@code serverSeed:clientSeed:nonce:block}。
     */
    static byte[] blockMessage(String serverSeed, String clientSeed, long nonce, long block) {
        String message = serverSeed + ':' + clientSeed + ':' + nonce + ':' + block;
        return message.getBytes(StandardCharsets.UTF_8);
    }
}
