# WASM 컨테이너 관리 가이드

Gaesup-State는 WASM 컨테이너를 도커처럼 독립적으로 실행하고 관리할 수 있는 기능을 제공합니다.

## 🚀 빠른 시작

### 1. 환경 설정

```bash
# 프로젝트 의존성 설치
pnpm install:all

# WASM 런타임 설치 (선택사항)
curl -sSf https://raw.githubusercontent.com/WasmEdge/WasmEdge/master/utils/install.sh | bash
curl https://wasmtime.dev/install.sh -sSf | bash
```

### 2. 컨테이너 실행

```bash
# 새 WASM 컨테이너 실행
pnpm gaesup run --name todo-app --runtime wasmtime --memory 50

# 컨테이너 목록 조회
pnpm gaesup list

# 컨테이너 상태 확인
pnpm gaesup status --id todo-app-123
```

### 3. 도커 배포

```bash
# 도커 이미지 빌드
pnpm docker:build

# WASM 컨테이너를 도커로 배포
pnpm docker:deploy

# 또는 개별 컨테이너 배포
pnpm gaesup deploy --id todo-app-123
```

## 📋 CLI 명령어

### 기본 컨테이너 관리

```bash
# 컨테이너 실행
pnpm gaesup run --name <container-name> [options]
  --runtime wasmtime|wasmedge|wasmer  # WASM 런타임 선택
  --memory <MB>                       # 최대 메모리 (기본: 100MB)
  --debug                            # 디버그 모드

# 컨테이너 목록
pnpm gaesup list

# 컨테이너 중지
pnpm gaesup stop --id <container-id>

# 컨테이너 재시작 (상태 유지)
pnpm gaesup restart --id <container-id>

# 핫 리로드 (코드 업데이트 후 상태 유지)
pnpm gaesup reload --id <container-id>
```

### 스케일링 및 배포

```bash
# 컨테이너 스케일링
pnpm gaesup scale --id <container-id> --replicas <number>

# 도커로 배포
pnpm gaesup deploy --id <container-id>

# 도커 컴포즈 파일 생성
pnpm gaesup compose --output docker-compose.yml
```

### 모니터링 및 디버깅

```bash
# 컨테이너 상태
pnpm gaesup status --id <container-id>

# 성능 메트릭
pnpm gaesup metrics --id <container-id>

# 헬스 체크
pnpm gaesup health

# 로그 조회
pnpm gaesup logs --id <container-id> --tail 100 --follow
```

### 정리

```bash
# 모든 컨테이너 정리
pnpm gaesup cleanup --force
```

## 🐳 도커 통합

### 도커 컴포즈 사용

```bash
# WASM 컨테이너 스택 실행
pnpm docker:wasm

# 로그 확인
pnpm docker:wasm:logs

# 컨테이너 재시작
pnpm docker:wasm:restart

# 정리
pnpm docker:wasm:down
```

### 수동 도커 빌드

```bash
# 개별 컨테이너 빌드
docker buildx build \
  --platform wasi/wasm \
  --tag gaesup/my-app:latest \
  --file Dockerfile.wasm \
  .

# WASM 런타임으로 실행
docker run --rm \
  --runtime io.containerd.wasmedge.v1 \
  --platform wasi/wasm \
  gaesup/my-app:latest
```

## 🔧 컨테이너 설정

### 기본 설정

```typescript
const config: ContainerConfig = {
  runtime: 'wasmtime',           // WASM 런타임
  maxMemory: 50 * 1024 * 1024,   // 50MB
  maxCpuTime: 5000,              // 5초
  networkAccess: false,          // 네트워크 접근 차단
  debugMode: true,               // 디버그 모드
  
  isolation: {
    memoryIsolation: true,       // 메모리 격리
    fileSystemAccess: false,     // 파일 시스템 접근 차단
    crossContainerComm: false    // 컨테이너간 통신 차단
  }
}
```

### 도커 환경 변수

```yaml
# docker-compose.yml
environment:
  - GAESUP_RUNTIME=wasmedge
  - GAESUP_MAX_MEMORY=50MB
  - GAESUP_DEBUG=true
  - GAESUP_ISOLATION=true
```

## 🔄 컨테이너 라이프사이클

### 1. 컨테이너 생성 및 시작

```typescript
// 프로그래밍 방식
import { ContainerManager } from '@gaesup-state/core';

const manager = new ContainerManager();

const container = await manager.run('my-app', {
  runtime: 'wasmtime',
  maxMemory: 100 * 1024 * 1024
});

console.log(`Container started: ${container.id}`);
```

### 2. 상태 업데이트

```typescript
// 컨테이너 상태 업데이트
await container.updateState({
  count: 42,
  items: ['item1', 'item2']
});

// 상태 구독
const unsubscribe = container.subscribe((newState) => {
  console.log('State updated:', newState);
});
```

### 3. 재시작 및 핫 리로드

```typescript
// 재시작 (상태 유지)
await container.restart();

// 핫 리로드 (새 WASM 모듈로 업데이트)
const newWasmModule = await loadNewModule();
await container.hotReload(newWasmModule);
```

### 4. 스케일링

```typescript
// 3개의 복제본 생성
const replicaIds = await container.scale(3);
console.log('Replicas created:', replicaIds);

// 매니저 레벨에서 스케일링
const replicas = await manager.scale('my-app-123', 5);
```

### 5. 도커 배포

```typescript
// 도커 컨테이너로 배포
const dockerId = await container.deployToDocker();
console.log(`Deployed to Docker: ${dockerId}`);

// 도커 컴포즈 생성
const compose = manager.generateDockerCompose();
console.log(compose);
```

## 📊 모니터링

### 메트릭 수집

```typescript
// 컨테이너 메트릭
const metrics = container.metrics;
console.log(`CPU: ${metrics.cpuUsage}%`);
console.log(`Memory: ${metrics.memoryUsage.used}/${metrics.memoryUsage.limit}`);
console.log(`Uptime: ${metrics.uptime}ms`);
console.log(`Calls: ${metrics.callCount}`);
console.log(`Errors: ${metrics.errorCount}`);
```

### 헬스 체크

```typescript
// 개별 컨테이너 헬스 체크
const health = await container.healthCheck();
console.log(`Healthy: ${health.healthy}`);

// 전체 헬스 체크
const allHealth = await manager.healthCheck();
Object.entries(allHealth).forEach(([id, health]) => {
  console.log(`${id}: ${health.healthy ? 'OK' : 'FAILED'}`);
});
```

## 🔐 보안 및 격리

### 메모리 격리

```typescript
const config: ContainerConfig = {
  maxMemory: 50 * 1024 * 1024,  // 50MB 제한
  
  isolation: {
    memoryIsolation: true,       // 메모리 격리 활성화
    fileSystemAccess: false,     // 파일 접근 차단
    networkAccess: false,        // 네트워크 접근 차단
    crossContainerComm: false    // 컨테이너간 통신 차단
  }
}
```

### 함수 호출 제한

```typescript
const config: ContainerConfig = {
  allowedImports: [
    'env.console_log',
    'env.memory',
    'wasi_snapshot_preview1.fd_write'
  ],
  
  maxCpuTime: 5000  // 5초 실행 시간 제한
}
```

## 🚨 에러 처리

### 컨테이너 에러

```typescript
try {
  const result = await container.call('risky_function', args);
} catch (error) {
  if (error instanceof ContainerTimeoutError) {
    console.log('Function timed out');
  } else if (error instanceof ContainerMemoryError) {
    console.log('Memory limit exceeded');
  } else if (error instanceof ContainerSecurityError) {
    console.log('Security violation');
  }
}
```

### 이벤트 기반 에러 처리

```typescript
manager.events.on('container:error', (event) => {
  console.error(`Container ${event.containerId} error:`, event.error);
});

manager.events.on('memory:warning', (event) => {
  console.warn(`Memory warning for ${event.containerId}`);
});
```

## 🛠️ 개발 도구

### 개발 모드

```bash
# 개발 모드로 컨테이너 실행
pnpm gaesup run --name dev-app --debug --runtime wasmtime

# 핫 리로드 활성화
pnpm gaesup reload --id dev-app-123
```

### 디버깅

```typescript
// 디버그 정보 활성화
const manager = new ContainerManager({
  debugMode: true,
  enableMetrics: true
});

// 상세 로그 확인
manager.events.on('function:call', (event) => {
  console.log(`Function called: ${event.functionName}`);
});
```

## 📈 성능 최적화

### WASM 최적화

```bash
# 최적화된 WASM 빌드
cargo build --target wasm32-wasi --release
wasm-opt -O3 target/wasm32-wasi/release/app.wasm -o optimized.wasm
```

### 컨테이너 캐싱

```typescript
// 컨테이너 캐시 설정
const manager = new ContainerManager({
  cacheSize: 200 * 1024 * 1024,  // 200MB 캐시
  maxContainers: 20               // 최대 20개 컨테이너
});
```

## 🔧 문제 해결

### 일반적인 문제

1. **WASM 런타임 없음**
   ```bash
   # WasmEdge 설치
   curl -sSf https://raw.githubusercontent.com/WasmEdge/WasmEdge/master/utils/install.sh | bash
   
   # Wasmtime 설치
   curl https://wasmtime.dev/install.sh -sSf | bash
   ```

2. **메모리 부족**
   ```bash
   # 메모리 제한 증가
   pnpm gaesup run --name my-app --memory 200
   ```

3. **컨테이너 응답 없음**
   ```bash
   # 컨테이너 재시작
   pnpm gaesup restart --id container-id
   
   # 강제 정리
   pnpm gaesup cleanup --force
   ```

### 로그 분석

```bash
# 컨테이너 로그 확인
pnpm gaesup logs --id container-id --tail 100

# 도커 로그 확인  
pnpm docker:wasm:logs

# 시스템 헬스 체크
pnpm gaesup health
```

## 🎯 사용 사례

### 1. 마이크로서비스 아키텍처

```bash
# 여러 서비스를 독립적인 WASM 컨테이너로 실행
pnpm gaesup run --name user-service --runtime wasmedge --memory 30
pnpm gaesup run --name auth-service --runtime wasmtime --memory 20
pnpm gaesup run --name data-service --runtime wasmer --memory 50

# 스케일링
pnpm gaesup scale --id user-service-123 --replicas 3
```

### 2. 개발 환경

```bash
# 개발용 컨테이너 (핫 리로드 포함)
pnpm gaesup run --name dev-app --debug --runtime wasmtime
pnpm gaesup reload --id dev-app-123  # 코드 변경 후 리로드
```

### 3. 프로덕션 배포

```bash
# 프로덕션 빌드 및 배포
pnpm build
pnpm docker:build production
pnpm docker:deploy
```

이제 WASM 컨테이너를 도커처럼 쉽게 관리할 수 있습니다! 🎉 