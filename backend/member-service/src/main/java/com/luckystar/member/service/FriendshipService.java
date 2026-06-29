package com.luckystar.member.service;

import com.luckystar.member.dto.FriendListResponse;
import com.luckystar.member.dto.FriendRelationshipUpdatedEvent;
import com.luckystar.member.dto.FriendshipResponse;
import com.luckystar.member.entity.Friendship;
import com.luckystar.member.entity.FriendshipStatus;
import com.luckystar.member.entity.Member;
import com.luckystar.member.exception.*;
import com.luckystar.member.repository.FriendshipRepository;
import com.luckystar.member.repository.MemberRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.function.Function;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
public class FriendshipService {

    private static final int FRIEND_LIMIT = 200;
    private static final String FRIEND_RELATIONSHIP_UPDATED_TOPIC = "friend.relationship.updated";

    private final FriendshipRepository friendshipRepository;
    private final MemberRepository memberRepository;
    private final OutboxService outboxService;

    @Transactional
    public FriendshipResponse sendFriendRequest(Long requesterId, Long receiverId) {
        if (requesterId.equals(receiverId)) {
            throw new SelfFriendRequestException();
        }

        if (!memberRepository.existsById(receiverId)) {
            throw new MemberNotFoundException("Member not found with id: " + receiverId);
        }

        if (friendshipRepository.countAcceptedFriends(requesterId) >= FRIEND_LIMIT) {
            throw new FriendLimitExceededException();
        }

        // 雙向查找是否已有好友關係記錄
        Optional<Friendship> existing = friendshipRepository
                .findByRequesterIdAndReceiverId(requesterId, receiverId)
                .or(() -> friendshipRepository.findByRequesterIdAndReceiverId(receiverId, requesterId));

        if (existing.isPresent()) {
            Friendship f = existing.get();
            if (f.getStatus() == FriendshipStatus.PENDING || f.getStatus() == FriendshipStatus.ACCEPTED) {
                throw new FriendshipAlreadyExistsException();
            }
            // 狀態為 REJECTED → 重新設為 PENDING
            f.setStatus(FriendshipStatus.PENDING);
            // 確保方向正確（requester 改為本次發送者）
            f.setRequesterId(requesterId);
            f.setReceiverId(receiverId);
            return toResponse(friendshipRepository.save(f));
        }

        Friendship friendship = new Friendship();
        friendship.setRequesterId(requesterId);
        friendship.setReceiverId(receiverId);
        friendship.setStatus(FriendshipStatus.PENDING);
        try {
            Friendship saved = friendshipRepository.save(friendship);
            // 立即 flush 讓 UNIQUE(requester_id, receiver_id) 衝突在此 try 內浮出，
            // 否則約束違反會延後到交易 commit、跳過下面的 catch。
            friendshipRepository.flush();
            return toResponse(saved);
        } catch (DataIntegrityViolationException e) {
            // 併發下兩個請求同時通過上方 existing 檢查並各自 insert，後手撞 UNIQUE，
            // 精準轉成 409「好友關係已存在」（而非落到全域 handler 的中性訊息）。
            throw new FriendshipAlreadyExistsException();
        }
    }

    @Transactional
    public FriendshipResponse acceptFriendRequest(Long friendshipId, Long currentPlayerId) {
        Friendship friendship = friendshipRepository.findById(friendshipId)
                .orElseThrow(FriendshipNotFoundException::new);

        if (!friendship.getReceiverId().equals(currentPlayerId)) {
            throw new ForbiddenOperationException();
        }

        if (friendship.getStatus() != FriendshipStatus.PENDING) {
            throw new InvalidFriendshipStatusException();
        }

        if (friendshipRepository.countAcceptedFriends(currentPlayerId) >= FRIEND_LIMIT) {
            throw new FriendLimitExceededException();
        }

        friendship.setStatus(FriendshipStatus.ACCEPTED);
        Friendship saved = friendshipRepository.save(friendship);
        friendshipRepository.flush();
        publishFriendRelationshipUpdated(saved.getRequesterId(), saved.getReceiverId());
        return toResponse(saved);
    }

    @Transactional
    public FriendshipResponse rejectFriendRequest(Long friendshipId, Long currentPlayerId) {
        Friendship friendship = friendshipRepository.findById(friendshipId)
                .orElseThrow(FriendshipNotFoundException::new);

        if (!friendship.getReceiverId().equals(currentPlayerId)) {
            throw new ForbiddenOperationException();
        }

        if (friendship.getStatus() != FriendshipStatus.PENDING) {
            throw new InvalidFriendshipStatusException();
        }

        friendship.setStatus(FriendshipStatus.REJECTED);
        return toResponse(friendshipRepository.save(friendship));
    }

    @Transactional(readOnly = true)
    public List<FriendListResponse> listFriends(Long playerId) {
        List<Friendship> friendships = friendshipRepository.findAcceptedFriends(playerId);

        List<Long> friendIds = friendships.stream()
                .map(f -> f.getRequesterId().equals(playerId) ? f.getReceiverId() : f.getRequesterId())
                .collect(Collectors.toList());

        Map<Long, Member> memberMap = memberRepository.findAllById(friendIds).stream()
                .collect(Collectors.toMap(Member::getId, Function.identity()));

        return friendships.stream()
                .map(f -> {
                    Long friendId = f.getRequesterId().equals(playerId) ? f.getReceiverId() : f.getRequesterId();
                    Member friend = memberMap.get(friendId);
                    return new FriendListResponse(
                            f.getId(),
                            friendId,
                            friend != null ? friend.getUsername() : null,
                            friend != null ? friend.getNickname() : null,
                            friend != null ? friend.getAvatar() : null,
                            f.getUpdatedAt()
                    );
                })
                .collect(Collectors.toList());
    }

    @Transactional
    public void deleteFriend(Long friendshipId, Long currentPlayerId) {
        Friendship friendship = friendshipRepository.findById(friendshipId)
                .orElseThrow(FriendshipNotFoundException::new);

        boolean isParty = friendship.getRequesterId().equals(currentPlayerId)
                || friendship.getReceiverId().equals(currentPlayerId);
        if (!isParty) {
            throw new ForbiddenOperationException();
        }

        if (friendship.getStatus() != FriendshipStatus.ACCEPTED) {
            throw new InvalidFriendshipStatusException();
        }

        friendshipRepository.delete(friendship);
        friendshipRepository.flush();
        publishFriendRelationshipUpdated(friendship.getRequesterId(), friendship.getReceiverId());
    }

    private void publishFriendRelationshipUpdated(Long... playerIds) {
        for (Long playerId : playerIds) {
            List<Long> friendIds = friendshipRepository.findAcceptedFriends(playerId).stream()
                    .map(friendship -> friendship.getRequesterId().equals(playerId)
                            ? friendship.getReceiverId()
                            : friendship.getRequesterId())
                    .sorted()
                    .toList();

            FriendRelationshipUpdatedEvent event =
                    new FriendRelationshipUpdatedEvent(playerId, friendIds);
            outboxService.save(FRIEND_RELATIONSHIP_UPDATED_TOPIC, playerId.toString(), event);
        }
    }

    private FriendshipResponse toResponse(Friendship f) {
        return new FriendshipResponse(
                f.getId(),
                f.getRequesterId(),
                f.getReceiverId(),
                f.getStatus().name(),
                f.getCreatedAt(),
                f.getUpdatedAt()
        );
    }
}
