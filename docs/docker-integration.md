# Docker 통합 가이드

## 개요

Gaesup-State는 실제 Docker 환경과 완벽하게 통합되어 WASM 컨테이너를 기존 Docker 워크플로우에 자연스럽게 포함시킬 수 있습니다. Docker Desktop의 WASM workloads 지원을 활용하여 진정한 하이브리드 컨테이너 환경을 구축할 수 있습니다.

## Docker + WASM 아키텍처

```
┌─────────────────────────────────────────────────┐
│                Docker Engine                    │
├─────────────────────────────────────────────────┤
│                  containerd                     │
├─────────────────────────────────────────────────┤
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ │
│  │    runc     │ │  WasmEdge   │ │  Wasmtime   │ │
│  │   (Linux)   │ │   Shim      │ │    Shim     │ │
│  └─────────────┘ └─────────────┘ └─────────────┘ │
├─────────────────────────────────────────────────┤
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ │
│  │   Linux     │ │    WASM     │ │    WASM     │ │
│  │ Container   │ │ Container A │ │ Container B │ │
│  │ (Database)  │ │(State Core) │ │(Math Utils) │ │
│  └─────────────┘ └─────────────┘ └─────────────┘ │
└─────────────────────────────────────────────────┘
```

## 지원 WASM 런타임

Docker Desktop에서 지원하는 WASM 런타임들:

| 런타임 | 식별자 | 특징 | 사용 사례 |
|--------|--------|------|----------|
| **WasmEdge** | `io.containerd.wasmedge.v1` | 높은 성능, 서버사이드 최적화 | 상태관리, API 서버 |
| **Wasmtime** | `io.containerd.wasmtime.v1` | 안정성, 표준 준수 | 범용 애플리케이션 |
| **Wasmer** | `io.containerd.wasmer.v1` | 언어별 최적화 | 언어 특화 모듈 |
| **Spin** | `io.containerd.spin.v2` | 마이크로서비스 특화 | 서버리스 함수 |

## 환경 설정

### 1. Docker Desktop 설정

```bash
# 1. Docker Desktop에서 containerd 이미지 스토어 활성화
# Settings > General > "Use containerd for pulling and storing images"

# 2. WASM workloads 활성화  
# Settings > Features in development > "Enable Wasm"

# 3. 설정 적용 및 런타임 설치
# Apply & Restart 클릭
```

### 2. CLI 확인

```bash
# WASM 런타임 설치 확인
docker info | grep -i wasm

# 사용 가능한 런타임 목록
docker system info | grep -A 10 "Runtimes"
```

## 기본 사용법

### 1. WASM 컨테이너 실행

```bash
# 기본 WASM 컨테이너 실행
docker run \
  --runtime=io.containerd.wasmedge.v1 \
  --platform=wasi/wasm \
  gaesup/state-core:latest

# 포트 바인딩과 함께 실행
docker run -p 8080:8080 \
  --runtime=io.containerd.wasmedge.v1 \
  --platform=wasi/wasm \
  gaesup/math-container:latest
```

### 2. 환경 변수 및 볼륨 마운트

```bash
# 환경 변수 설정
docker run \
  --runtime=io.containerd.wasmedge.v1 \
  --platform=wasi/wasm \
  -e STATE_CONFIG=production \
  -e MAX_MEMORY=50MB \
  gaesup/state-core:latest

# 볼륨 마운트 (제한적 지원)
docker run \
  --runtime=io.containerd.wasmedge.v1 \
  --platform=wasi/wasm \
  -v $(pwd)/config:/app/config:ro \
  gaesup/state-core:latest
```

## Docker Compose 통합

### 1. 하이브리드 서비스 구성

```yaml
# docker-compose.yml
version: '3.8'

services:
  # 기존 Linux 컨테이너 (데이터베이스)
  postgres:
    image: postgres:15
    environment:
      POSTGRES_DB: app_db
      POSTGRES_USER: user
      POSTGRES_PASSWORD: password
    volumes:
      - pg_data:/var/lib/postgresql/data

  # WASM 상태관리 서비스
  state-manager:
    image: gaesup/state-core:latest
    platform: wasi/wasm
    runtime: io.containerd.wasmedge.v1
    environment:
      - DATABASE_URL=postgresql://user:password@postgres:5432/app_db
      - MAX_MEMORY=100MB
      - ISOLATION_LEVEL=strict
    depends_on:
      - postgres
    ports:
      - "3001:3001"

  # WASM 계산 서비스
  math-service:
    image: gaesup/math-utils:latest
    platform: wasi/wasm
    runtime: io.containerd.wasmtime.v1
    environment:
      - PRECISION=high
      - PARALLEL_WORKERS=4
    ports:
      - "3002:3002"

  # 프론트엔드 (일반 컨테이너)
  frontend:
    image: node:18-alpine
    command: npm start
    volumes:
      - ./frontend:/app
    working_dir: /app
    ports:
      - "3000:3000"
    environment:
      - REACT_APP_STATE_URL=http://state-manager:3001
      - REACT_APP_MATH_URL=http://math-service:3002

volumes:
  pg_data:
```

### 2. 개발 환경 구성

```yaml
# docker-compose.dev.yml
version: '3.8'

services:
  state-manager:
    image: gaesup/state-core:dev
    platform: wasi/wasm
    runtime: io.containerd.wasmedge.v1
    environment:
      - NODE_ENV=development
      - DEBUG=true
      - HOT_RELOAD=true
    volumes:
      - ./wasm-modules:/app/modules:ro
    ports:
      - "3001:3001"
      - "9229:9229" # 디버깅 포트

  # 개발용 레지스트리
  registry:
    image: gaesup/container-registry:dev
    platform: wasi/wasm
    runtime: io.containerd.wasmedge.v1
    ports:
      - "5000:5000"
    volumes:
      - registry_data:/var/lib/registry

volumes:
  registry_data:
```

## 커스텀 WASM 컨테이너 빌드

### 1. Dockerfile 작성

```dockerfile
# Dockerfile.wasm
# syntax=docker/dockerfile:1

# 빌드 스테이지
FROM rust:1.70 as builder

WORKDIR /app
COPY Cargo.toml Cargo.lock ./
COPY src/ ./src/

# WASM 타겟 설치
RUN rustup target add wasm32-wasi

# WASM 바이너리 빌드
RUN cargo build --target wasm32-wasi --release

# 런타임 스테이지
FROM scratch

# WASM 바이너리만 복사
COPY --from=builder /app/target/wasm32-wasi/release/state-core.wasm /state-core.wasm

# 엔트리포인트 설정
ENTRYPOINT ["/state-core.wasm"]
```

### 2. 멀티 아키텍처 빌드

```bash
# buildx를 사용한 WASM 이미지 빌드
docker buildx build \
  --platform wasi/wasm \
  -t gaesup/state-core:latest \
  -f Dockerfile.wasm \
  --push .

# 멀티 플랫폼 빌드 (Linux + WASM)
docker buildx build \
  --platform linux/amd64,linux/arm64,wasi/wasm \
  -t gaesup/state-core:multi \
  --push .
```

### 3. 이미지 최적화

```dockerfile
# 최적화된 Dockerfile
FROM rust:1.70-slim as builder

# wasm-opt 설치 (바이너리 최적화)
RUN apt-get update && apt-get install -y \
    binaryen \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY . .

# 최적화된 빌드
RUN cargo build --target wasm32-wasi --release

# 바이너리 최적화
RUN wasm-opt -Os \
    target/wasm32-wasi/release/state-core.wasm \
    -o state-core-optimized.wasm

FROM scratch
COPY --from=builder /app/state-core-optimized.wasm /state-core.wasm
ENTRYPOINT ["/state-core.wasm"]
```

## 네트워킹 및 통신

### 1. 서비스 간 통신

```yaml
# 내부 네트워크 구성
services:
  state-manager:
    platform: wasi/wasm
    runtime: io.containerd.wasmedge.v1
    networks:
      - backend
    
  api-gateway:
    image: nginx:alpine
    networks:
      - frontend
      - backend
    
networks:
  frontend:
    driver: bridge
  backend:
    driver: bridge
    internal: true
```

### 2. 로드 밸런싱

```yaml
# nginx.conf
upstream wasm_backend {
    server state-manager-1:3001;
    server state-manager-2:3001;
    server state-manager-3:3001;
}

server {
    location /api/state {
        proxy_pass http://wasm_backend;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

## 모니터링 및 로깅

### 1. 컨테이너 로그

```bash
# WASM 컨테이너 로그 확인
docker logs state-manager

# 실시간 로그 스트림
docker logs -f state-manager

# 구조화된 로그
docker logs state-manager --since 1h | jq '.'
```

### 2. 메트릭 수집

```yaml
# Prometheus 메트릭 수집
services:
  state-manager:
    platform: wasi/wasm
    runtime: io.containerd.wasmedge.v1
    environment:
      - METRICS_ENABLED=true
      - METRICS_PORT=9090
    
  prometheus:
    image: prom/prometheus
    command:
      - '--config.file=/etc/prometheus/prometheus.yml'
      - '--web.enable-lifecycle'
    volumes:
      - ./prometheus.yml:/etc/prometheus/prometheus.yml
```

```yaml
# prometheus.yml
scrape_configs:
  - job_name: 'wasm-containers'
    static_configs:
      - targets:
        - 'state-manager:9090'
        - 'math-service:9090'
```

### 3. 헬스 체크

```yaml
services:
  state-manager:
    platform: wasi/wasm
    runtime: io.containerd.wasmedge.v1
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3001/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s
```

## 배포 전략

### 1. Blue-Green 배포

```bash
#!/bin/bash
# blue-green-deploy.sh

# Green 환경 배포
docker-compose -f docker-compose.green.yml up -d

# 헬스 체크
curl -f http://green-state-manager:3001/health

# 트래픽 전환
docker-compose -f docker-compose.yml \
  exec nginx nginx -s reload

# Blue 환경 종료
docker-compose -f docker-compose.blue.yml down
```

### 2. 롤링 업데이트

```yaml
# docker-compose.prod.yml
services:
  state-manager:
    image: gaesup/state-core:${VERSION}
    platform: wasi/wasm
    runtime: io.containerd.wasmedge.v1
    deploy:
      replicas: 3
      update_config:
        parallelism: 1
        delay: 10s
        failure_action: rollback
      restart_policy:
        condition: on-failure
        delay: 5s
        max_attempts: 3
```

## 트러블슈팅

### 1. 일반적인 문제들

```bash
# 1. WASM 런타임이 설치되지 않은 경우
docker: Error response from daemon: Unknown runtime specified io.containerd.wasmedge.v1

# 해결: Docker Desktop에서 WASM 기능 활성화

# 2. 플랫폼 불일치
docker: Error response from daemon: no matching manifest for wasi/wasm in the manifest list entries

# 해결: 올바른 플랫폼 지정
docker run --platform=wasi/wasm gaesup/state-core:latest

# 3. 메모리 제한 초과
WASM execution error: out of memory

# 해결: 메모리 제한 증가
docker run --runtime=io.containerd.wasmedge.v1 \
  --platform=wasi/wasm \
  -e MAX_MEMORY=100MB \
  gaesup/state-core:latest
```

### 2. 디버깅 도구

```bash
# WASM 바이너리 분석
wasm-objdump -x state-core.wasm

# 메모리 사용량 프로파일링
docker stats state-manager

# 성능 분석
docker exec state-manager /app/profiler --duration=60s
```

## 보안 고려사항

### 1. WASM 샌드박싱

```yaml
services:
  state-manager:
    platform: wasi/wasm
    runtime: io.containerd.wasmedge.v1
    environment:
      # 엄격한 샌드박스 모드
      - WASM_SANDBOX=strict
      - ALLOW_NETWORK=false
      - ALLOW_FILESYSTEM=false
    security_opt:
      - no-new-privileges:true
```

### 2. 리소스 제한

```yaml
services:
  state-manager:
    platform: wasi/wasm
    runtime: io.containerd.wasmedge.v1
    environment:
      - MAX_MEMORY=50MB
      - MAX_CPU_TIME=1000ms
      - MAX_OPEN_FILES=100
    deploy:
      resources:
        limits:
          memory: 64M
          cpus: '0.5'
```

## 결론

Docker + WASM 통합을 통해 다음과 같은 이점을 얻을 수 있습니다:

- **일관된 개발 환경**: 기존 Docker 워크플로우 유지
- **하이브리드 아키텍처**: Linux 컨테이너와 WASM 컨테이너 혼용
- **향상된 성능**: WASM의 성능 우위와 Docker의 편의성
- **보안 강화**: 이중 샌드박싱 (Docker + WASM)
- **쉬운 배포**: 기존 Docker 배포 파이프라인 재사용

이러한 통합은 현대적인 클라우드 네이티브 애플리케이션 개발의 새로운 표준을 제시합니다. 