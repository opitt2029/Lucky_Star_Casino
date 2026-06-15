package com.luckystar.game.rng;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * {@link ProvablyFairRng} 的單元測試（純 JUnit，不載入 Spring 容器）。
 */
class ProvablyFairRngTest {

    private final ProvablyFairRng rng = new ProvablyFairRng();

    @Test
    @DisplayName("產生的 server seed 為 64 位 hex 且每次不同")
    void generateServerSeed_isHex64AndUnique() {
        String a = rng.generateServerSeed();
        String b = rng.generateServerSeed();
        assertEquals(64, a.length(), "32 bytes 應為 64 hex 字元");
        assertTrue(a.matches("[0-9a-f]{64}"), "應為小寫 hex");
        assertNotEquals(a, b, "兩次產生應不同");
    }

    @Test
    @DisplayName("commit 為 server seed 的 SHA-256，且可被 verifyCommitment 驗證")
    void commit_matchesSha256AndVerifies() throws NoSuchAlgorithmException {
        String serverSeed = "deadbeef";
        String commitment = rng.commit(serverSeed);

        byte[] expected = MessageDigest.getInstance("SHA-256")
                .digest(serverSeed.getBytes(StandardCharsets.UTF_8));
        assertEquals(toHex(expected), commitment);

        assertTrue(rng.verifyCommitment(serverSeed, commitment), "正確 seed 應通過驗證");
        assertTrue(rng.verifyCommitment(serverSeed, commitment.toUpperCase()),
                "驗證應大小寫不拘");
    }

    @Test
    @DisplayName("錯誤的 server seed 無法通過承諾驗證")
    void verifyCommitment_rejectsTampering() {
        String serverSeed = rng.generateServerSeed();
        String commitment = rng.commit(serverSeed);

        assertFalse(rng.verifyCommitment(serverSeed + "00", commitment), "竄改 seed 應失敗");
        assertFalse(rng.verifyCommitment(null, commitment));
        assertFalse(rng.verifyCommitment(serverSeed, null));
    }

    @Test
    @DisplayName("相同三元組產生完全相同的隨機序列（確定性 / 可重算）")
    void stream_isDeterministic() {
        String server = rng.generateServerSeed();
        String client = "player-seed-123";

        int[] first = rng.stream(server, client, 7L).nextInts(20, 1000);
        int[] second = rng.stream(server, client, 7L).nextInts(20, 1000);

        assertArraysEqual(first, second);
    }

    @Test
    @DisplayName("nonce 不同會產生不同序列")
    void stream_differsByNonce() {
        String server = rng.generateServerSeed();
        String client = "player-seed-123";

        int[] n1 = rng.stream(server, client, 1L).nextInts(20, 1000);
        int[] n2 = rng.stream(server, client, 2L).nextInts(20, 1000);

        assertFalse(java.util.Arrays.equals(n1, n2), "不同 nonce 應產生不同序列");
    }

    @Test
    @DisplayName("computeOutcomeHash 等於首個雜湊區塊，且外部可獨立重算")
    void computeOutcomeHash_isFirstBlock() {
        String server = "server-seed";
        String client = "client-seed";
        long nonce = 42L;

        String hash = ProvablyFairRng.computeOutcomeHash(server, client, nonce);
        byte[] expected = ProvablyFairRng.sha256(
                RandomStream.blockMessage(server, client, nonce, 0));

        assertEquals(toHex(expected), hash);
        assertEquals(64, hash.length());
    }

    private static void assertArraysEqual(int[] a, int[] b) {
        assertTrue(java.util.Arrays.equals(a, b),
                "序列應相同: " + java.util.Arrays.toString(a) + " vs " + java.util.Arrays.toString(b));
    }

    private static String toHex(byte[] bytes) {
        StringBuilder sb = new StringBuilder();
        for (byte b : bytes) {
            sb.append(String.format("%02x", b & 0xFF));
        }
        return sb.toString();
    }
}
