# syntax=docker/dockerfile:1

# ---- Stage 1: build ----
FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /workspace

COPY pom.xml .
COPY backend/gateway-service/pom.xml backend/gateway-service/pom.xml
COPY backend/member-service/pom.xml backend/member-service/pom.xml
COPY backend/wallet-service/pom.xml backend/wallet-service/pom.xml
COPY backend/game-service/pom.xml backend/game-service/pom.xml
COPY backend/rank-service/pom.xml backend/rank-service/pom.xml
COPY backend/admin-service/pom.xml backend/admin-service/pom.xml
COPY backend/notification-service/pom.xml backend/notification-service/pom.xml

RUN --mount=type=cache,target=/root/.m2 \
    mvn -q -pl backend/gateway-service -am dependency:go-offline

COPY backend backend
RUN --mount=type=cache,target=/root/.m2 \
    mvn -q -pl backend/gateway-service -am -DskipTests package

# ---- Stage 2: runtime ----
FROM eclipse-temurin:21-jre-jammy AS runtime
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --system --create-home --shell /usr/sbin/nologin appuser
COPY --from=build /workspace/backend/gateway-service/target/gateway-service-0.0.1-SNAPSHOT.jar app.jar
USER appuser
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
