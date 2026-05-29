package com.luckystar.wallet.config;

import jakarta.persistence.EntityManagerFactory;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.jdbc.DataSourceBuilder;
import org.springframework.boot.orm.jpa.EntityManagerFactoryBuilder;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Primary;
import org.springframework.data.jpa.repository.config.EnableJpaRepositories;
import org.springframework.orm.jpa.JpaTransactionManager;
import org.springframework.orm.jpa.LocalContainerEntityManagerFactoryBean;
import org.springframework.transaction.PlatformTransactionManager;

import javax.sql.DataSource;
import java.util.HashMap;
import java.util.Map;

/**
 * ADR-001 CQRS 雙資料庫設定。
 *
 * 寫端（@Primary）：PostgreSQL — wallets、wallet_transactions 寫入
 *   - package: com.luckystar.wallet.postgres.{entity,repository}
 *   - 預設 EntityManager / TransactionManager
 *
 * 讀端：MySQL — wallet_transactions 讀庫、gift_logs
 *   - package: com.luckystar.wallet.mysql.{entity,repository}
 *   - 透過 @Qualifier("mysqlEntityManagerFactory") / "mysqlTransactionManager" 注入
 */
@Configuration
@EnableJpaRepositories(
        basePackages = "com.luckystar.wallet.postgres.repository",
        entityManagerFactoryRef = "postgresEntityManagerFactory",
        transactionManagerRef = "postgresTransactionManager"
)
public class DataSourceConfig {

    // ============================================================
    // PostgreSQL — 寫端（Primary）
    // ============================================================

    @Primary
    @Bean("postgresDataSource")
    @ConfigurationProperties(prefix = "spring.datasource")
    public DataSource postgresDataSource() {
        return DataSourceBuilder.create().build();
    }

    @Primary
    @Bean("postgresEntityManagerFactory")
    public LocalContainerEntityManagerFactoryBean postgresEntityManagerFactory(
            EntityManagerFactoryBuilder builder,
            @Qualifier("postgresDataSource") DataSource dataSource) {
        Map<String, Object> props = new HashMap<>();
        props.put("hibernate.dialect", "org.hibernate.dialect.PostgreSQLDialect");
        props.put("hibernate.hbm2ddl.auto", System.getProperty("jpa.ddl-auto", System.getenv().getOrDefault("JPA_DDL_AUTO", "validate")));
        return builder
                .dataSource(dataSource)
                .packages("com.luckystar.wallet.postgres.entity")
                .persistenceUnit("postgres")
                .properties(props)
                .build();
    }

    @Primary
    @Bean("postgresTransactionManager")
    public PlatformTransactionManager postgresTransactionManager(
            @Qualifier("postgresEntityManagerFactory") EntityManagerFactory emf) {
        return new JpaTransactionManager(emf);
    }

    // ============================================================
    // MySQL — 讀端（CQRS Query 端）
    // ============================================================

    @Bean("mysqlDataSource")
    @ConfigurationProperties(prefix = "spring.datasource-mysql")
    public DataSource mysqlDataSource() {
        return DataSourceBuilder.create().build();
    }

    @Bean("mysqlEntityManagerFactory")
    public LocalContainerEntityManagerFactoryBean mysqlEntityManagerFactory(
            EntityManagerFactoryBuilder builder,
            @Qualifier("mysqlDataSource") DataSource dataSource) {
        Map<String, Object> props = new HashMap<>();
        props.put("hibernate.dialect", "org.hibernate.dialect.MySQLDialect");
        // 讀端僅讀現成 schema，正式環境固定 validate；測試（surefire jpa.ddl-auto=create）
        // 需在 H2 自動建表，故與寫端共用同一組態來源（system property → env → 預設 validate）。
        props.put("hibernate.hbm2ddl.auto", System.getProperty("jpa.ddl-auto", System.getenv().getOrDefault("JPA_DDL_AUTO", "validate")));
        return builder
                .dataSource(dataSource)
                .packages("com.luckystar.wallet.mysql.entity")
                .persistenceUnit("mysql")
                .properties(props)
                .build();
    }

    @Bean("mysqlTransactionManager")
    public PlatformTransactionManager mysqlTransactionManager(
            @Qualifier("mysqlEntityManagerFactory") EntityManagerFactory emf) {
        return new JpaTransactionManager(emf);
    }
}
