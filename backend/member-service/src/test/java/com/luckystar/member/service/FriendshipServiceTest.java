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
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class FriendshipServiceTest {

    @Mock
    private FriendshipRepository friendshipRepository;

    @Mock
    private MemberRepository memberRepository;

    @Mock
    private OutboxService outboxService;

    @InjectMocks
    private FriendshipService friendshipService;

    // ── sendFriendRequest ────────────────────────────────────────────────

    @Test
    void sendFriendRequest_sameId_throwsSelfFriendRequestException() {
        assertThatThrownBy(() -> friendshipService.sendFriendRequest(1L, 1L))
                .isInstanceOf(SelfFriendRequestException.class);
    }

    @Test
    void sendFriendRequest_receiverNotFound_throwsMemberNotFoundException() {
        when(memberRepository.existsById(2L)).thenReturn(false);

        assertThatThrownBy(() -> friendshipService.sendFriendRequest(1L, 2L))
                .isInstanceOf(MemberNotFoundException.class);
    }

    @Test
    void sendFriendRequest_requesterAtFriendLimit_throwsFriendLimitExceededException() {
        when(memberRepository.existsById(2L)).thenReturn(true);
        when(friendshipRepository.countAcceptedFriends(1L)).thenReturn(200L);

        assertThatThrownBy(() -> friendshipService.sendFriendRequest(1L, 2L))
                .isInstanceOf(FriendLimitExceededException.class);
    }

    @Test
    void sendFriendRequest_alreadyAccepted_throwsFriendshipAlreadyExistsException() {
        when(memberRepository.existsById(2L)).thenReturn(true);
        when(friendshipRepository.countAcceptedFriends(1L)).thenReturn(0L);

        Friendship existing = buildFriendship(10L, 1L, 2L, FriendshipStatus.ACCEPTED);
        when(friendshipRepository.findByRequesterIdAndReceiverId(1L, 2L)).thenReturn(Optional.of(existing));

        assertThatThrownBy(() -> friendshipService.sendFriendRequest(1L, 2L))
                .isInstanceOf(FriendshipAlreadyExistsException.class);
    }

    @Test
    void sendFriendRequest_rejectedFriendship_resetsToRending() {
        when(memberRepository.existsById(2L)).thenReturn(true);
        when(friendshipRepository.countAcceptedFriends(1L)).thenReturn(0L);

        Friendship rejected = buildFriendship(10L, 2L, 1L, FriendshipStatus.REJECTED);
        // 反方向記錄
        when(friendshipRepository.findByRequesterIdAndReceiverId(1L, 2L)).thenReturn(Optional.empty());
        when(friendshipRepository.findByRequesterIdAndReceiverId(2L, 1L)).thenReturn(Optional.of(rejected));
        when(friendshipRepository.save(any(Friendship.class))).thenAnswer(inv -> inv.getArgument(0));

        FriendshipResponse result = friendshipService.sendFriendRequest(1L, 2L);

        assertThat(result.status()).isEqualTo("PENDING");
        assertThat(result.requesterId()).isEqualTo(1L);
        assertThat(result.receiverId()).isEqualTo(2L);
    }

    @Test
    void sendFriendRequest_newRequest_savesAndReturnsPending() {
        when(memberRepository.existsById(2L)).thenReturn(true);
        when(friendshipRepository.countAcceptedFriends(1L)).thenReturn(0L);
        when(friendshipRepository.findByRequesterIdAndReceiverId(1L, 2L)).thenReturn(Optional.empty());
        when(friendshipRepository.findByRequesterIdAndReceiverId(2L, 1L)).thenReturn(Optional.empty());

        Friendship saved = buildFriendship(11L, 1L, 2L, FriendshipStatus.PENDING);
        when(friendshipRepository.save(any(Friendship.class))).thenReturn(saved);

        FriendshipResponse result = friendshipService.sendFriendRequest(1L, 2L);

        assertThat(result.status()).isEqualTo("PENDING");
        assertThat(result.requesterId()).isEqualTo(1L);
        verify(friendshipRepository, times(1)).save(any(Friendship.class));
    }

    @Test
    void sendFriendRequest_concurrentInsertHitsUniqueConstraint_throwsFriendshipAlreadyExists() {
        when(memberRepository.existsById(2L)).thenReturn(true);
        when(friendshipRepository.countAcceptedFriends(1L)).thenReturn(0L);
        when(friendshipRepository.findByRequesterIdAndReceiverId(1L, 2L)).thenReturn(Optional.empty());
        when(friendshipRepository.findByRequesterIdAndReceiverId(2L, 1L)).thenReturn(Optional.empty());
        when(friendshipRepository.save(any(Friendship.class)))
                .thenReturn(buildFriendship(12L, 1L, 2L, FriendshipStatus.PENDING));
        // 併發後手 insert：flush 時撞 UNIQUE(requester_id, receiver_id)
        doThrow(new org.springframework.dao.DataIntegrityViolationException("duplicate"))
                .when(friendshipRepository).flush();

        // 應被精準轉成 FriendshipAlreadyExistsException（→ 409 好友關係已存在），而非外洩 DataIntegrityViolationException
        assertThatThrownBy(() -> friendshipService.sendFriendRequest(1L, 2L))
                .isInstanceOf(FriendshipAlreadyExistsException.class);
    }

    // ── acceptFriendRequest ──────────────────────────────────────────────

    @Test
    void acceptFriendRequest_notReceiver_throwsForbiddenOperationException() {
        Friendship f = buildFriendship(5L, 1L, 2L, FriendshipStatus.PENDING);
        when(friendshipRepository.findById(5L)).thenReturn(Optional.of(f));

        // currentPlayerId=3 is neither requester nor receiver
        assertThatThrownBy(() -> friendshipService.acceptFriendRequest(5L, 3L))
                .isInstanceOf(ForbiddenOperationException.class);
    }

    @Test
    void acceptFriendRequest_statusNotPending_throwsInvalidFriendshipStatusException() {
        Friendship f = buildFriendship(5L, 1L, 2L, FriendshipStatus.ACCEPTED);
        when(friendshipRepository.findById(5L)).thenReturn(Optional.of(f));

        assertThatThrownBy(() -> friendshipService.acceptFriendRequest(5L, 2L))
                .isInstanceOf(InvalidFriendshipStatusException.class);
    }

    @Test
    void acceptFriendRequest_valid_statusBecomesAccepted() {
        Friendship f = buildFriendship(5L, 1L, 2L, FriendshipStatus.PENDING);
        when(friendshipRepository.findById(5L)).thenReturn(Optional.of(f));
        when(friendshipRepository.countAcceptedFriends(2L)).thenReturn(0L);
        when(friendshipRepository.save(any(Friendship.class))).thenAnswer(inv -> inv.getArgument(0));
        when(friendshipRepository.findAcceptedFriends(1L)).thenReturn(List.of(f));
        when(friendshipRepository.findAcceptedFriends(2L)).thenReturn(List.of(f));

        FriendshipResponse result = friendshipService.acceptFriendRequest(5L, 2L);

        assertThat(result.status()).isEqualTo("ACCEPTED");
        verify(outboxService).save(
                "friend.relationship.updated",
                "1",
                new FriendRelationshipUpdatedEvent(1L, List.of(2L)));
        verify(outboxService).save(
                "friend.relationship.updated",
                "2",
                new FriendRelationshipUpdatedEvent(2L, List.of(1L)));
    }

    // ── rejectFriendRequest ──────────────────────────────────────────────

    @Test
    void rejectFriendRequest_valid_statusBecomesRejected() {
        Friendship f = buildFriendship(6L, 1L, 2L, FriendshipStatus.PENDING);
        when(friendshipRepository.findById(6L)).thenReturn(Optional.of(f));
        when(friendshipRepository.save(any(Friendship.class))).thenAnswer(inv -> inv.getArgument(0));

        FriendshipResponse result = friendshipService.rejectFriendRequest(6L, 2L);

        assertThat(result.status()).isEqualTo("REJECTED");
    }

    // ── deleteFriend ─────────────────────────────────────────────────────

    @Test
    void deleteFriend_notParty_throwsForbiddenOperationException() {
        Friendship f = buildFriendship(7L, 1L, 2L, FriendshipStatus.ACCEPTED);
        when(friendshipRepository.findById(7L)).thenReturn(Optional.of(f));

        assertThatThrownBy(() -> friendshipService.deleteFriend(7L, 99L))
                .isInstanceOf(ForbiddenOperationException.class);
    }

    @Test
    void deleteFriend_statusPending_throwsInvalidFriendshipStatusException() {
        Friendship f = buildFriendship(7L, 1L, 2L, FriendshipStatus.PENDING);
        when(friendshipRepository.findById(7L)).thenReturn(Optional.of(f));

        assertThatThrownBy(() -> friendshipService.deleteFriend(7L, 1L))
                .isInstanceOf(InvalidFriendshipStatusException.class);
    }

    @Test
    void deleteFriend_valid_repositoryDeleteCalledOnce() {
        Friendship f = buildFriendship(7L, 1L, 2L, FriendshipStatus.ACCEPTED);
        when(friendshipRepository.findById(7L)).thenReturn(Optional.of(f));
        when(friendshipRepository.findAcceptedFriends(1L)).thenReturn(List.of());
        when(friendshipRepository.findAcceptedFriends(2L)).thenReturn(List.of());

        friendshipService.deleteFriend(7L, 2L);

        verify(friendshipRepository, times(1)).delete(f);
        verify(outboxService).save(
                "friend.relationship.updated",
                "1",
                new FriendRelationshipUpdatedEvent(1L, List.of()));
        verify(outboxService).save(
                "friend.relationship.updated",
                "2",
                new FriendRelationshipUpdatedEvent(2L, List.of()));
    }

    // ── listFriends ───────────────────────────────────────────────────────

    @Test
    void listFriends_twoFriendships_returnsCorrectFriendIds() {
        // playerId=1 為 requester 的好友關係（friendId=2）
        Friendship f1 = buildFriendship(10L, 1L, 2L, FriendshipStatus.ACCEPTED);
        // playerId=1 為 receiver 的好友關係（friendId=3）
        Friendship f2 = buildFriendship(11L, 3L, 1L, FriendshipStatus.ACCEPTED);

        when(friendshipRepository.findAcceptedFriends(1L)).thenReturn(List.of(f1, f2));

        Member m2 = buildMember(2L, "alice", "Alice", "avatar2.png");
        Member m3 = buildMember(3L, "bob", "Bob", "avatar3.png");
        when(memberRepository.findAllById(anyList())).thenReturn(List.of(m2, m3));

        List<FriendListResponse> result = friendshipService.listFriends(1L);

        assertThat(result).hasSize(2);
        assertThat(result).extracting(FriendListResponse::friendId)
                .containsExactlyInAnyOrder(2L, 3L);
    }

    // ── helpers ───────────────────────────────────────────────────────────

    private Friendship buildFriendship(Long id, Long requesterId, Long receiverId, FriendshipStatus status) {
        Friendship f = new Friendship();
        f.setId(id);
        f.setRequesterId(requesterId);
        f.setReceiverId(receiverId);
        f.setStatus(status);
        f.setCreatedAt(LocalDateTime.now());
        f.setUpdatedAt(LocalDateTime.now());
        return f;
    }

    private Member buildMember(Long id, String username, String nickname, String avatar) {
        Member m = new Member();
        m.setId(id);
        m.setUsername(username);
        m.setNickname(nickname);
        m.setAvatar(avatar);
        return m;
    }
}
