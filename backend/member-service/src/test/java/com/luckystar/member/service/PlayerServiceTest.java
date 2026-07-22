package com.luckystar.member.service;

import com.luckystar.member.dto.ProfileResponse;
import com.luckystar.member.dto.UpdateProfileRequest;
import com.luckystar.member.entity.Member;
import com.luckystar.member.exception.MemberNotFoundException;
import com.luckystar.member.exception.NoUpdateFieldException;
import com.luckystar.member.repository.MemberRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.LocalDateTime;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class PlayerServiceTest {

    @Mock
    private MemberRepository memberRepository;

    @InjectMocks
    private PlayerService playerService;

    private Member sampleMember;

    @BeforeEach
    void setUp() {
        sampleMember = new Member();
        sampleMember.setId(1L);
        sampleMember.setUsername("alice");
        sampleMember.setEmail("alice@example.com");
        sampleMember.setPasswordHash("$2a$10$hashedpassword");
        sampleMember.setNickname("Alice");
        sampleMember.setAvatar(null);
        sampleMember.setRole("PLAYER");
        sampleMember.setStatus("ACTIVE");
        // 手動設定 createdAt，避免單元測試中沒有觸發 @PrePersist。
        try {
            var field = Member.class.getDeclaredField("createdAt");
            field.setAccessible(true);
            field.set(sampleMember, LocalDateTime.of(2026, 5, 27, 10, 0, 0));
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
    }

    @Test
    void getProfile_success() {
        when(memberRepository.findById(1L)).thenReturn(Optional.of(sampleMember));

        ProfileResponse result = playerService.getProfile(1L);

        assertThat(result.getNickname()).isEqualTo("Alice");
        assertThat(result.getPlayerId()).isEqualTo(1L);
        assertThat(result.getUsername()).isEqualTo("alice");
    }

    @Test
    void getProfile_memberNotFound() {
        when(memberRepository.findById(99L)).thenReturn(Optional.empty());

        assertThatThrownBy(() -> playerService.getProfile(99L))
                .isInstanceOf(MemberNotFoundException.class)
                .hasMessageContaining("99");
    }

    @Test
    void updateProfile_nicknameOnly_success() {
        when(memberRepository.findById(1L)).thenReturn(Optional.of(sampleMember));
        when(memberRepository.save(any(Member.class))).thenReturn(sampleMember);

        UpdateProfileRequest request = new UpdateProfileRequest();
        request.setNickname("Bob");
        request.setAvatar(null);

        ProfileResponse result = playerService.updateProfile(1L, request);

        verify(memberRepository, times(1)).save(any(Member.class));
        assertThat(result.getNickname()).isEqualTo("Bob");
    }

    @Test
    void updateProfile_avatarUrl_success() {
        when(memberRepository.findById(1L)).thenReturn(Optional.of(sampleMember));
        when(memberRepository.save(any(Member.class))).thenReturn(sampleMember);

        UpdateProfileRequest request = new UpdateProfileRequest();
        request.setNickname(null);
        request.setAvatar("https://example.com/avatar.png");

        ProfileResponse result = playerService.updateProfile(1L, request);

        verify(memberRepository, times(1)).save(any(Member.class));
        assertThat(result.getAvatar()).isEqualTo("https://example.com/avatar.png");
    }

    @Test
    void updateProfile_avatarBase64_success() {
        when(memberRepository.findById(1L)).thenReturn(Optional.of(sampleMember));
        when(memberRepository.save(any(Member.class))).thenReturn(sampleMember);

        UpdateProfileRequest request = new UpdateProfileRequest();
        request.setNickname(null);
        request.setAvatar("data:image/png;base64,abc123");

        playerService.updateProfile(1L, request);

        verify(memberRepository, times(1)).save(any(Member.class));
    }

    @Test
    void updateProfile_noFields_throwsException() {
        UpdateProfileRequest request = new UpdateProfileRequest();
        request.setNickname(null);
        request.setAvatar(null);

        assertThatThrownBy(() -> playerService.updateProfile(1L, request))
                .isInstanceOf(NoUpdateFieldException.class)
                .hasMessageContaining("At least one field");
    }

    @Test
    void updateProfile_memberNotFound() {
        when(memberRepository.findById(99L)).thenReturn(Optional.empty());

        UpdateProfileRequest request = new UpdateProfileRequest();
        request.setNickname("Test");
        request.setAvatar(null);

        assertThatThrownBy(() -> playerService.updateProfile(99L, request))
                .isInstanceOf(MemberNotFoundException.class)
                .hasMessageContaining("99");
    }

    @Test
    void updateStatus_disable_persistsDisabled() {
        when(memberRepository.findById(1L)).thenReturn(Optional.of(sampleMember));
        when(memberRepository.save(any(Member.class))).thenReturn(sampleMember);

        String result = playerService.updateStatus(1L, false);

        assertThat(result).isEqualTo("DISABLED");
        assertThat(sampleMember.getStatus()).isEqualTo("DISABLED");
        verify(memberRepository, times(1)).save(sampleMember);
    }

    @Test
    void updateStatus_enable_persistsActive() {
        sampleMember.setStatus("DISABLED");
        when(memberRepository.findById(1L)).thenReturn(Optional.of(sampleMember));
        when(memberRepository.save(any(Member.class))).thenReturn(sampleMember);

        String result = playerService.updateStatus(1L, true);

        assertThat(result).isEqualTo("ACTIVE");
        assertThat(sampleMember.getStatus()).isEqualTo("ACTIVE");
    }

    @Test
    void updateStatus_memberNotFound() {
        when(memberRepository.findById(99L)).thenReturn(Optional.empty());

        assertThatThrownBy(() -> playerService.updateStatus(99L, false))
                .isInstanceOf(MemberNotFoundException.class)
                .hasMessageContaining("99");
        verify(memberRepository, never()).save(any(Member.class));
    }

    @Test
    void getSocialBindings_returnsAllProviders() {
        when(memberRepository.findById(1L)).thenReturn(Optional.of(sampleMember));

        var result = playerService.getSocialBindings(1L);

        assertThat(result).hasSize(3);
        assertThat(result).extracting("provider").containsExactly("line", "google", "apple");
        assertThat(result).allMatch(binding -> !binding.isBound());
    }

    @Test
    void completeSocialBinding_returnsDemoBoundResponse() {
        when(memberRepository.findById(1L)).thenReturn(Optional.of(sampleMember));

        var result = playerService.completeSocialBinding(1L, "google", null);

        assertThat(result.isBound()).isTrue();
        assertThat(result.getStatus()).isEqualTo("BOUND");
        assertThat(result.getMaskedAccountId()).isEqualTo("demo-linked");
        verify(memberRepository, never()).save(any(Member.class));
    }

    @Test
    void removeSocialBinding_returnsDemoUnboundResponse() {
        when(memberRepository.findById(1L)).thenReturn(Optional.of(sampleMember));

        var result = playerService.removeSocialBinding(1L, "line");

        assertThat(result.isBound()).isFalse();
        assertThat(result.getStatus()).isEqualTo("UNBOUND");
        assertThat(result.getMaskedAccountId()).isNull();
        verify(memberRepository, never()).save(any(Member.class));
    }

    @Test
    void startSocialBinding_unknownProvider_throws() {
        when(memberRepository.findById(1L)).thenReturn(Optional.of(sampleMember));

        assertThatThrownBy(() -> playerService.startSocialBinding(1L, "twitter"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("Unsupported social provider");
    }
}
