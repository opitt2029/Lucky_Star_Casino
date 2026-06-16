package com.luckystar.admin.mysql.repository;

import com.luckystar.admin.mysql.entity.MemberRead;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;

/**
 * 玩家帳號唯讀查詢（MySQL 讀庫，由 mysqlTransactionManager 管理）。
 */
public interface MemberReadRepository extends JpaRepository<MemberRead, Long> {

    /** 以帳號或暱稱關鍵字（不分大小寫）分頁搜尋。 */
    Page<MemberRead> findByUsernameContainingIgnoreCaseOrNicknameContainingIgnoreCase(
            String username, String nickname, Pageable pageable);
}
