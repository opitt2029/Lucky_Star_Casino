package com.luckystar.member.service;

import com.luckystar.member.dto.ProfileResponse;
import com.luckystar.member.dto.UpdateProfileRequest;
import com.luckystar.member.entity.Member;
import com.luckystar.member.entity.MemberSocialAccount;
import com.luckystar.member.exception.MemberNotFoundException;
import com.luckystar.member.exception.NoUpdateFieldException;
import com.luckystar.member.repository.MemberRepository;
import com.luckystar.member.repository.MemberSocialAccountRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.security.crypto.password.PasswordEncoder;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class PlayerServiceTest {

    @Mock
    private MemberRepository memberRepository;

    @Mock
    private MemberSocialAccountRepository socialAccountRepository;

    @Mock
    private SocialAuthService socialAuthService;

    @Mock
    private PasswordEncoder passwordEncoder;

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
        sampleMember.setRealName("Wang Alice");
        sampleMember.setBirthDate(LocalDate.of(1992, 2, 3));
        sampleMember.setGender("FEMALE");
        sampleMember.setAddress("Taipei");
        sampleMember.setWalletPaymentMethod("STAR_COIN");
        sampleMember.setPaymentConfirmationEnabled(true);
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
        assertThat(result.getRealName()).isEqualTo("Wang Alice");
        assertThat(result.getBirthDate()).isEqualTo("1992-02-03");
        assertThat(result.getWalletPaymentMethod()).isEqualTo("STAR_COIN");
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
    void updateProfile_sensitiveFields_requirePasswordAndPersist() {
        when(memberRepository.findById(1L)).thenReturn(Optional.of(sampleMember));
        when(passwordEncoder.matches("secret", "$2a$10$hashedpassword")).thenReturn(true);
        when(memberRepository.save(any(Member.class))).thenReturn(sampleMember);

        UpdateProfileRequest request = new UpdateProfileRequest();
        request.setGender("MALE");
        request.setAddress("Kaohsiung");
        request.setWalletPaymentMethod("ASK_EVERY_TIME");
        request.setPaymentConfirmationEnabled(false);
        request.setCurrentPassword("secret");

        ProfileResponse result = playerService.updateProfile(1L, request);

        assertThat(result.getGender()).isEqualTo("MALE");
        assertThat(result.getAddress()).isEqualTo("Kaohsiung");
        assertThat(result.getWalletPaymentMethod()).isEqualTo("ASK_EVERY_TIME");
        assertThat(result.getPaymentConfirmationEnabled()).isFalse();
    }

    @Test
    void updateProfile_sensitiveFields_wrongPasswordThrows() {
        when(memberRepository.findById(1L)).thenReturn(Optional.of(sampleMember));
        when(passwordEncoder.matches("bad", "$2a$10$hashedpassword")).thenReturn(false);

        UpdateProfileRequest request = new UpdateProfileRequest();
        request.setAddress("Kaohsiung");
        request.setCurrentPassword("bad");

        assertThatThrownBy(() -> playerService.updateProfile(1L, request))
                .isInstanceOf(com.luckystar.member.exception.InvalidCredentialsException.class);
        verify(memberRepository, never()).save(any(Member.class));
    }

    @Test
    void verifyProfileSettingsPassword_acceptsCurrentPassword() {
        when(memberRepository.findById(1L)).thenReturn(Optional.of(sampleMember));
        when(passwordEncoder.matches("secret", "$2a$10$hashedpassword")).thenReturn(true);

        playerService.verifyProfileSettingsPassword(1L, "secret");
    }

    @Test
    void updateProfile_noFields_throwsException() {
        UpdateProfileRequest request = new UpdateProfileRequest();
        request.setNickname(null);
        request.setAvatar(null);

        assertThatThrownBy(() -> playerService.updateProfile(1L, request))
                .isInstanceOf(NoUpdateFieldException.class)
                .hasMessageContaining("At least one profile field");
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
    void updateVipLevel_grant_persistsVip() {
        when(memberRepository.findById(1L)).thenReturn(Optional.of(sampleMember));
        when(memberRepository.save(any(Member.class))).thenReturn(sampleMember);

        String result = playerService.updateVipLevel(1L, "VIP");

        assertThat(result).isEqualTo("VIP");
        assertThat(sampleMember.getVipLevel()).isEqualTo("VIP");
        verify(memberRepository, times(1)).save(sampleMember);
    }

    @Test
    void updateVipLevel_revoke_persistsNormal() {
        sampleMember.setVipLevel("VIP");
        when(memberRepository.findById(1L)).thenReturn(Optional.of(sampleMember));
        when(memberRepository.save(any(Member.class))).thenReturn(sampleMember);

        String result = playerService.updateVipLevel(1L, "NORMAL");

        assertThat(result).isEqualTo("NORMAL");
        assertThat(sampleMember.getVipLevel()).isEqualTo("NORMAL");
    }

    @Test
    void updateVipLevel_memberNotFound() {
        when(memberRepository.findById(99L)).thenReturn(Optional.empty());

        assertThatThrownBy(() -> playerService.updateVipLevel(99L, "VIP"))
                .isInstanceOf(MemberNotFoundException.class)
                .hasMessageContaining("99");
        verify(memberRepository, never()).save(any(Member.class));
    }

    /** 新會員預設為 NORMAL——預設值錯掉會讓所有人一上線就是 VIP。 */
    @Test
    void newMember_defaultsToNormalTier() {
        assertThat(new Member().getVipLevel()).isEqualTo("NORMAL");
    }

    @Test
    void getSocialBindings_returnsAllProviders() {
        when(memberRepository.findById(1L)).thenReturn(Optional.of(sampleMember));
        when(socialAccountRepository.findAllByMemberId(1L)).thenReturn(List.of());

        var result = playerService.getSocialBindings(1L);

        assertThat(result).hasSize(3);
        assertThat(result).extracting("provider").containsExactly("line", "google", "apple");
        assertThat(result).allMatch(binding -> !binding.isBound());
    }

    @Test
    void getSocialBindings_masksBoundEmail() {
        when(memberRepository.findById(1L)).thenReturn(Optional.of(sampleMember));
        MemberSocialAccount account = new MemberSocialAccount();
        account.setMember(sampleMember);
        account.setProvider("google");
        account.setProviderSubject("google-subject-1234");
        account.setEmail("alice@example.com");
        when(socialAccountRepository.findAllByMemberId(1L)).thenReturn(List.of(account));

        var result = playerService.getSocialBindings(1L).stream()
                .filter(binding -> "google".equals(binding.getProvider()))
                .findFirst()
                .orElseThrow();

        assertThat(result.isBound()).isTrue();
        assertThat(result.getStatus()).isEqualTo("BOUND");
        assertThat(result.getMaskedAccountId()).isEqualTo("al***@example.com");
    }

    @Test
    void removeSocialBinding_deletesPersistedBinding() {
        when(memberRepository.findById(1L)).thenReturn(Optional.of(sampleMember));
        MemberSocialAccount account = new MemberSocialAccount();
        account.setMember(sampleMember);
        account.setProvider("line");
        account.setProviderSubject("line-subject");
        when(socialAccountRepository.findByMemberIdAndProvider(1L, "line"))
                .thenReturn(Optional.of(account));

        var result = playerService.removeSocialBinding(1L, "line");

        assertThat(result.isBound()).isFalse();
        assertThat(result.getStatus()).isEqualTo("UNBOUND");
        assertThat(result.getMaskedAccountId()).isNull();
        verify(socialAccountRepository).delete(account);
    }

    @Test
    void startSocialBinding_delegatesToOAuthService() {
        var expected = new com.luckystar.member.dto.SocialBindingStartResponse(
                "google",
                "Google",
                "READY",
                "/api/v1/auth/social/google/authorize?bindingTicket=ticket");
        when(socialAuthService.startBinding(1L, "google")).thenReturn(expected);

        assertThat(playerService.startSocialBinding(1L, "google")).isSameAs(expected);
    }
}
