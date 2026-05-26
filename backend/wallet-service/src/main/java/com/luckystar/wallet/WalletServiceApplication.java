package com.luckystar.wallet;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

// 注意：wallet-service 使用雙資料庫（PostgreSQL 寫庫 + MySQL 讀庫）
// 雙 DataSource Bean 設定請參考 config/DataSourceConfig.java（T-002 後補）
@SpringBootApplication
public class WalletServiceApplication {

    public static void main(String[] args) {
        SpringApplication.run(WalletServiceApplication.class, args);
    }
}
