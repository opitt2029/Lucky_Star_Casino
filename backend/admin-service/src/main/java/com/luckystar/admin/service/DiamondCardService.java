package com.luckystar.admin.service;

import com.luckystar.admin.dto.CardStatusFilter;
import com.luckystar.admin.dto.DiamondCardView;
import com.luckystar.admin.dto.GenerateCardsResponse;
import com.luckystar.admin.mysql.entity.DiamondCard;
import com.luckystar.admin.mysql.repository.DiamondCardRepository;
import com.luckystar.admin.postgres.entity.AdminActionLog;
import com.luckystar.admin.postgres.repository.AdminActionLogRepository;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 鑽石點數卡產生與查詢（T-105 / T-106）。寫入 MySQL {@code diamond_cards}（admin 的 @Primary 源）。
 * 每次生成另落一筆 {@code admin_action_logs}（PostgreSQL，best-effort，比照 AdminShopService）——
 * 生成即等同印出可兌換星幣的價值，須留稽核痕跡。
 */
@Service
public class DiamondCardService {

    private static final Logger log = LoggerFactory.getLogger(DiamondCardService.class);

    private final DiamondCardRepository diamondCardRepository;
    private final AdminActionLogRepository actionLogRepository;

    public DiamondCardService(DiamondCardRepository diamondCardRepository,
                               AdminActionLogRepository actionLogRepository) {
        this.diamondCardRepository = diamondCardRepository;
        this.actionLogRepository = actionLogRepository;
    }

    /**
     * 批量生成唯一序號卡。序號格式 {@code XXXX-XXXX-XXXX-XXXX}（16 碼 hex 大寫，UUID 取頭）。
     * 同批內去重，並以 {@code existsByCardCode} 避開既有序號（card_code UNIQUE）。
     */
    @Transactional(transactionManager = "mysqlTransactionManager")
    public GenerateCardsResponse generateCards(String operator, int count, long faceValue) {
        Set<String> codes = new LinkedHashSet<>();
        while (codes.size() < count) {
            String code = generateCode();
            if (!codes.contains(code) && !diamondCardRepository.existsByCardCode(code)) {
                codes.add(code);
            }
        }

        List<DiamondCard> cards = codes.stream()
                .map(code -> new DiamondCard(code, faceValue))
                .toList();
        diamondCardRepository.saveAll(cards);

        writeAudit(operator, count, faceValue);
        return new GenerateCardsResponse(count, faceValue, new ArrayList<>(codes));
    }

    /** 稽核：寫一筆 admin_action_logs（PostgreSQL）。best-effort，失敗只記 WARN，不影響卡片生成。 */
    private void writeAudit(String operator, int count, long faceValue) {
        try {
            String idempotencyKey = "diamond-card-generate-" + UUID.randomUUID();
            actionLogRepository.save(new AdminActionLog(
                    operator, "DIAMOND_CARD_GENERATE", null, faceValue * count,
                    "generate " + count + " card(s) @ " + faceValue, idempotencyKey));
        } catch (RuntimeException e) {
            log.warn("Failed to write admin_action_logs for DIAMOND_CARD_GENERATE by {}: {}",
                    operator, e.getMessage());
        }
    }

    @Transactional(transactionManager = "mysqlTransactionManager", readOnly = true)
    public Page<DiamondCardView> listCards(CardStatusFilter status, Pageable pageable) {
        Page<DiamondCard> page = switch (status) {
            case REDEEMED -> diamondCardRepository.findByRedeemed(true, pageable);
            case UNREDEEMED -> diamondCardRepository.findByRedeemed(false, pageable);
            case ALL -> diamondCardRepository.findAll(pageable);
        };
        return page.map(this::toView);
    }

    private String generateCode() {
        String hex = UUID.randomUUID().toString().replace("-", "").substring(0, 16).toUpperCase();
        return String.join("-",
                hex.substring(0, 4), hex.substring(4, 8), hex.substring(8, 12), hex.substring(12, 16));
    }

    private DiamondCardView toView(DiamondCard card) {
        return new DiamondCardView(
                card.getCardCode(),
                card.getFaceValue() != null ? card.getFaceValue() : 0L,
                card.isRedeemed(),
                card.getRedeemedBy(),
                card.getRedeemedAt(),
                card.getCreatedAt());
    }
}
