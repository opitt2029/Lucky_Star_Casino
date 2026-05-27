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
        // 手動設定 createdAt，因為 @PrePersist 在 new 時不會自動觸發
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
}
