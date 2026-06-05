package com.luckystar.game.rng;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;

import org.springframework.stereotype.Component;

/**
 * Provably Fair RNG 引擎（T-030）。
 *
 * <p>採用 commit-reveal 機制，確保每一局結果在開局前即已決定、且事後可被玩家獨立驗證：
 * <ol>
 *   <li><b>commit</b>：開局前由伺服器產生 {@code serverSeed}（保密），並對外公布其雜湊
 *       {@code commitment = SHA-256(serverSeed)}。玩家此時無法得知 {@code serverSeed}，
 *       但雜湊已鎖定，伺服器事後無法竄改。</li>
 *   <li><b>play</b>：每次下注以 {@code (serverSeed, clientSeed, nonce)} 三元組推導隨機結果。
 *       {@code clientSeed} 由玩家提供（或預設亂數）、{@code nonce} 在同一 seed 配對下逐筆遞增。</li>
 *   <li><b>reveal</b>：開局結束後揭露 {@code serverSeed}，玩家可自行計算
 *       {@code SHA-256(serverSeed)} 比對 commitment，並用三元組重算結果，確認未被作弊。</li>
 * </ol>
 *
 * <p>隨機數核心演算法為 architecture.md §2.4 指定的
 * {@code SHA-256(serverSeed + clientSeed + nonce)}；本實作以 {@code ':'} 為分隔符
 * （{@code serverSeed:clientSeed:nonce:block}）消除字串串接的歧義，並以遞增的 {@code block}
 * 索引在單局內延伸出足量隨機位元組（見 {@link RandomStream}）。
 *
 * <p>本類別為純函式、無狀態，可安全地在多執行緒間共用。
 */
@Component
public class ProvablyFairRng {

    /** Server seed 位元組長度（32 bytes → 64 hex 字元）。 */
    private static final int SERVER_SEED_BYTES = 32;

    /** 預設 client seed 位元組長度（玩家未指定時使用）。 */
    private static final int CLIENT_SEED_BYTES = 16;

    private static final String HASH_ALGORITHM = "SHA-256";

    /** {@link SecureRandom} 為執行緒安全，共用單一實例即可。 */
    private static final SecureRandom SECURE_RANDOM = new SecureRandom();

    /**
     * 產生一個密碼學等級的 server seed（保密值），以小寫 hex 字串表示。
     */
    public String generateServerSeed() {
        return randomHex(SERVER_SEED_BYTES);
    }

    /**
     * 當玩家未自訂 client seed 時，產生一個預設 client seed。
     */
    public String generateClientSeed() {
        return randomHex(CLIENT_SEED_BYTES);
    }

    /**
     * 計算 server seed 的承諾雜湊 {@code SHA-256(serverSeed)}，於開局前對外公布。
     *
     * @param serverSeed 保密的 server seed
     * @return 小寫 hex 表示的 commitment 雜湊
     */
    public String commit(String serverSeed) {
        return sha256Hex(serverSeed.getBytes(StandardCharsets.UTF_8));
    }

    /**
     * 驗證揭露的 server seed 是否對應到先前公布的承諾雜湊。
     *
     * <p>以常數時間比較避免時序側通道。
     *
     * @param serverSeed     事後揭露的 server seed
     * @param expectedCommit 開局前公布的承諾雜湊（hex，大小寫不拘）
     * @return 相符回傳 {@code true}
     */
    public boolean verifyCommitment(String serverSeed, String expectedCommit) {
        if (serverSeed == null || expectedCommit == null) {
            return false;
        }
        byte[] actual = sha256Hex(serverSeed.getBytes(StandardCharsets.UTF_8))
                .getBytes(StandardCharsets.UTF_8);
        byte[] expected = expectedCommit.toLowerCase().getBytes(StandardCharsets.UTF_8);
        return MessageDigest.isEqual(actual, expected);
    }

    /**
     * 以 {@code (serverSeed, clientSeed, nonce)} 建立一條確定性隨機數串流。
     *
     * <p>相同三元組必定產出相同序列，這是「可驗證公平」的基礎。
     *
     * @param serverSeed 保密 server seed
     * @param clientSeed 玩家 client seed
     * @param nonce      同一 seed 配對下的下注序號（逐筆遞增）
     * @return 確定性隨機數串流
     */
    public RandomStream stream(String serverSeed, String clientSeed, long nonce) {
        return new RandomStream(serverSeed, clientSeed, nonce);
    }

    /**
     * 計算某次下注的「結果雜湊」{@code SHA-256(serverSeed:clientSeed:nonce:0)}（首個區塊）。
     *
     * <p>此值適合存入 {@code game_rounds} 供日後公平性驗證（T-036）使用，
     * 也讓外部驗證者不需依賴本服務即可重算。
     *
     * @return 小寫 hex 表示的結果雜湊
     */
    public static String computeOutcomeHash(String serverSeed, String clientSeed, long nonce) {
        return sha256Hex(RandomStream.blockMessage(serverSeed, clientSeed, nonce, 0));
    }

    // ----------------------------------------------------------------------
    // 內部工具
    // ----------------------------------------------------------------------

    private static String randomHex(int byteLength) {
        byte[] bytes = new byte[byteLength];
        SECURE_RANDOM.nextBytes(bytes);
        return toHex(bytes);
    }

    private static String sha256Hex(byte[] input) {
        return toHex(sha256(input));
    }

    static byte[] sha256(byte[] input) {
        try {
            return MessageDigest.getInstance(HASH_ALGORITHM).digest(input);
        } catch (NoSuchAlgorithmException e) {
            // SHA-256 為 JDK 必備演算法，理論上不會發生。
            throw new IllegalStateException("SHA-256 演算法不可用", e);
        }
    }

    static String toHex(byte[] bytes) {
        char[] hexChars = new char[bytes.length * 2];
        for (int i = 0; i < bytes.length; i++) {
            int v = bytes[i] & 0xFF;
            hexChars[i * 2] = HEX_DIGITS[v >>> 4];
            hexChars[i * 2 + 1] = HEX_DIGITS[v & 0x0F];
        }
        return new String(hexChars);
    }

    private static final char[] HEX_DIGITS = "0123456789abcdef".toCharArray();
}
