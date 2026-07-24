package com.luckystar.member.repository;

import com.luckystar.member.entity.MemberSocialAccount;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface MemberSocialAccountRepository extends JpaRepository<MemberSocialAccount, Long> {

    Optional<MemberSocialAccount> findByProviderAndProviderSubject(
            String provider,
            String providerSubject);

    Optional<MemberSocialAccount> findByMemberIdAndProvider(Long memberId, String provider);

    List<MemberSocialAccount> findAllByMemberId(Long memberId);
}
