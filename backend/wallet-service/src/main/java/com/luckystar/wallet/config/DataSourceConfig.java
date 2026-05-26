package com.luckystar.wallet.config;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.jdbc.DataSourceBuilder;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import javax.sql.DataSource;

/**
 * 雙資料庫設定（ADR-001：CQRS 讀寫分離）
 *
 * - @Primary DataSource（PostgreSQL）由 spring.datasource 自動配置，JPA 使用此庫
 * - mysqlDataSource（MySQL）透過 @Qualifier("mysqlDataSource") 注入，
 *   供 wallet_transactions 讀庫查詢（T-025）與 gift_logs 使用
 *
 * 使用方式：
 *   @Autowired
 *   @Qualifier("mysqlDataSource")
 *   private DataSource mysqlDataSource;
 */
@Configuration
public class DataSourceConfig {

    /**
     * MySQL 讀庫 DataSource（CQRS 讀端）
     * 對應 application.yml 的 spring.datasource-mysql 區塊
     */
    @Bean("mysqlDataSource")
    @ConfigurationProperties(prefix = "spring.datasource-mysql")
    public DataSource mysqlDataSource() {
        return DataSourceBuilder.create().build();
    }
}
