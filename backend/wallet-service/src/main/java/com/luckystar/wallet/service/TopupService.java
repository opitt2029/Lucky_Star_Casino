package com.luckystar.wallet.service;

import com.luckystar.wallet.dto.CreditRequest;
import com.luckystar.wallet.dto.CreditResponse;
import com.luckystar.wallet.dto.TopupOrderResponse;
import com.luckystar.wallet.dto.TopupPackageResponse;
import com.luckystar.wallet.exception.IllegalTopupStateException;
import com.luckystar.wallet.exception.InvalidTopupPackageException;
import com.luckystar.wallet.exception.TopupOrderNotFoundException;
import com.luckystar.wallet.postgres.entity.TopupOrder;
import com.luckystar.wallet.postgres.repository.TopupOrderRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ThreadLocalRandom;

/**
 * 玩家自助加值（模擬支付，無真實金流）。
 *
 * <p>方案清單寫死於 {@link #PACKAGES}。流程：
 * <ol>
 *   <li>{@link #createOrder} 建立 CREATED 訂單；</li>
 *   <li>{@link #pay} 模擬付款 → 同一 PostgreSQL 交易內呼叫 {@link WalletService#credit}（subType=TOPUP，
 *       冪等鍵 {@code topup-<orderNo>}）真實入帳 → 訂單轉 CREDITED 並記 creditTxId。</li>
 * </ol>
 *
 * <p>付款與入帳在同一交易（同 postgresTransactionManager）內完成，保證「訂單已入帳」與
 * 「錢包已加錢」原子一致；以 orderNo 當入帳冪等鍵，配合訂單狀態守衛雙重防止重複入帳。
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class TopupService {

    /** 加值方案清單（模擬商品，售價為顯示用、無真實金流）。 */
    private static final Map<String, TopupPackageResponse> PACKAGES = new LinkedHashMap<>();
    static {
        PACKAGES.put("P100", new TopupPackageResponse("P100", "NT$100", 100_000L));
        PACKAGES.put("P500", new TopupPackageResponse("P500", "NT$500", 600_000L));
        PACKAGES.put("P1000", new TopupPackageResponse("P1000", "NT$1000", 1_300_000L));
    }

    private final TopupOrderRepository topupOrderRepository;
    private final WalletService walletService;

    /** 取得可選加值方案。 */
    public List<TopupPackageResponse> getPackages() {
        return List.copyOf(PACKAGES.values());
    }

    /** 建立加值訂單（status=CREATED）。 */
    @Transactional(transactionManager = "postgresTransactionManager")
    public TopupOrderResponse createOrder(Long playerId, String packageId) {
        TopupPackageResponse pkg = PACKAGES.get(packageId);
        if (pkg == null) {
            throw new InvalidTopupPackageException("Unknown topup package: " + packageId);
        }

        TopupOrder order = TopupOrder.builder()
                .orderNo(generateOrderNo(playerId))
                .playerId(playerId)
                .packageId(pkg.packageId())
                .amount(pkg.amount())
                .priceLabel(pkg.priceLabel())
                .status("CREATED")
                .build();
        TopupOrder saved = topupOrderRepository.save(order);
        log.info("Topup order created: orderNo={} playerId={} package={} amount={}",
                saved.getOrderNo(), playerId, packageId, pkg.amount());
        return TopupOrderResponse.from(saved);
    }

    /**
     * 模擬付款並真實入帳。僅 CREATED 狀態可付款；其餘狀態丟 {@link IllegalTopupStateException}（409）。
     *
     * <p>入帳走 {@link WalletService#credit}（冪等鍵 topup-orderNo），與本訂單更新同屬一個
     * PostgreSQL 交易，任一步失敗整筆回滾。
     */
    @Transactional(transactionManager = "postgresTransactionManager")
    public TopupOrderResponse pay(Long playerId, Long orderId) {
        TopupOrder order = topupOrderRepository.findByIdAndPlayerId(orderId, playerId)
                .orElseThrow(() -> new TopupOrderNotFoundException("Topup order not found: " + orderId));

        if (!"CREATED".equals(order.getStatus())) {
            throw new IllegalTopupStateException(
                    "Order " + order.getOrderNo() + " is not payable (status=" + order.getStatus() + ")");
        }

        // 模擬付款成功
        order.setStatus("PAID");
        order.setPaidAt(LocalDateTime.now());

        // 真實入帳：以 orderNo 當冪等鍵，防止重複加值
        CreditRequest credit = new CreditRequest();
        credit.setPlayerId(playerId);
        credit.setAmount(order.getAmount());
        credit.setSubType("TOPUP");
        credit.setIdempotencyKey("topup-" + order.getOrderNo());
        credit.setReferenceId(order.getOrderNo());
        CreditResponse creditResponse = walletService.credit(credit);

        order.setStatus("CREDITED");
        order.setCreditTxId(creditResponse.getTransactionId());
        TopupOrder saved = topupOrderRepository.save(order);

        log.info("Topup order credited: orderNo={} playerId={} amount={} txId={} balanceAfter={}",
                saved.getOrderNo(), playerId, saved.getAmount(),
                creditResponse.getTransactionId(), creditResponse.getBalanceAfter());
        return TopupOrderResponse.from(saved, creditResponse.getBalanceAfter());
    }

    /** 查某玩家的加值訂單（新到舊）。 */
    @Transactional(readOnly = true, transactionManager = "postgresTransactionManager")
    public List<TopupOrderResponse> listOrders(Long playerId) {
        return topupOrderRepository.findByPlayerIdOrderByCreatedAtDesc(playerId).stream()
                .map(TopupOrderResponse::from)
                .toList();
    }

    /** 產生唯一訂單編號（<=40 字，order_no UNIQUE 為最後防線）。 */
    private String generateOrderNo(Long playerId) {
        long now = System.currentTimeMillis();
        int rand = ThreadLocalRandom.current().nextInt(1000, 10000);
        return "TOP" + now + "-" + playerId + "-" + rand;
    }
}
