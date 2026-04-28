# Gaesup-State 문서

Gaesup-State는 프론트엔드에서 WASM 패키지를 작은 컨테이너처럼 다루기 위한 상태 관리 및 실행 런타임입니다. 핵심은 단순히 상태를 빠르게 업데이트하는 것이 아니라, 컨테이너가 어떤 의존성, 어떤 ABI, 어떤 store schema를 기대하는지 명시하고 실행 전에 검증하는 것입니다.

## 왜 필요한가

프론트엔드가 커지면 다음 문제가 생깁니다.

- 여러 프레임워크가 같은 상태를 서로 다르게 복사해서 들고 있음
- WASM 패키지가 어떤 host 의존성을 기대하는지 불명확함
- 패키지별 의존성 버전이 충돌함
- store schema가 맞지 않는데 같은 전역 상태에 붙으면서 상태가 어긋남
- 컨테이너처럼 격리하고 싶지만 브라우저에서는 Docker 컨테이너를 그대로 쓸 수 없음

Gaesup-State는 이 문제를 다음 방식으로 풉니다.

- WASM 패키지는 manifest로 ABI, 의존성, 권한, store 계약을 선언합니다.
- host는 `CompatibilityGuard`로 manifest를 먼저 검증합니다.
- 패키지가 자기 의존성을 번들링하면 host 의존성과 충돌하지 않고 실행할 수 있습니다.
- store schema가 맞으면 공유 store에 붙고, 맞지 않으면 격리 store로 실행해야 합니다.
- React, Vue, Svelte, Angular 어댑터는 같은 Gaesup store를 구독합니다.

## 현재 구현된 범위

현재 저장소에는 다음이 구현되어 있습니다.

- `GaesupCore` 기반 named store 생성, 조회, dispatch, subscribe
- store schema 등록 및 조회
- container manifest 타입
- package dependency 계약
- bundled dependency 표시
- store dependency 계약
- `CompatibilityGuard` 검증
- `ContainerManager` manifest 검증 연결
- React, Vue, Svelte, Angular 패키지 빌드
- multi-framework demo
- dependency isolation demo
- container builder manifest 생성 흐름

## 빠른 실행

```bash
corepack enable
corepack prepare pnpm@8.10.0 --activate
pnpm install
pnpm -r --filter "./packages/**" run build
pnpm --filter @gaesup-state/multi-framework-demo run dev -- --host 0.0.0.0
```

브라우저에서 엽니다.

```text
http://localhost:3000/
```

데모는 두 페이지로 구성됩니다.

1. 공유 카운터
   - React, Vue, Svelte, Angular-like 카드가 같은 store를 구독합니다.
   - 어느 카드에서 버튼을 눌러도 네 카드의 count가 같이 바뀝니다.

2. 의존성 격리 확인
   - host 의존성을 공유해도 되는 패키지
   - 자기 의존성을 패키징해서 실행되는 패키지
   - store schema 충돌로 격리 실행되는 패키지
   - host 의존성 충돌로 차단되는 패키지

## 핵심 개념

### Store

store는 `storeId`로 식별됩니다. 하나의 store는 여러 프레임워크에서 동시에 구독할 수 있습니다.

```typescript
await GaesupCore.createStore('orders', { items: [] }, {
  schema: {
    storeId: 'orders',
    schemaId: 'orders-state',
    schemaVersion: '1.2.0'
  }
});
```

### Container manifest

WASM 컨테이너는 실행 전에 manifest를 제공합니다.

```typescript
const manifest = {
  manifestVersion: '1.0',
  name: 'orders-widget',
  version: '1.0.0',
  gaesup: { abiVersion: '^1.0.0' },
  dependencies: [
    { name: 'date-fns', version: '^2.29.0', source: 'host' }
  ],
  stores: [
    {
      storeId: 'orders',
      schemaId: 'orders-state',
      schemaVersion: '^1.2.0',
      conflictPolicy: 'reject'
    }
  ]
};
```

### Bundled dependency

컨테이너가 자기 의존성을 패키징하면 host 의존성 버전과 충돌하지 않습니다.

```typescript
dependencies: [
  { name: 'chart.js', version: '^3.9.0', source: 'bundled' }
]
```

이 경우 host가 `chart.js@4.4.3`을 쓰고 있어도 컨테이너는 자기 내부의 `chart.js@3`으로 실행될 수 있습니다.

### Store conflict

store schema가 맞지 않을 때 선택지는 정책에 따라 달라집니다.

- `reject`: 공유 store 접근을 차단하고 실행 실패
- `isolate`: 공유 store 대신 격리 store namespace로 실행
- `readonly`: 읽기 전용 정책, 런타임 enforcement 필요
- `migrate`: schema migration 흐름, 별도 구현 필요

현재 런타임 enforcement가 없는 정책은 실제 `ContainerManager`에서 fail-closed로 처리합니다. 데모에서는 정책 의미를 보여주기 위해 `CompatibilityGuard` 판정 결과를 시각화합니다.

## 문서 목록

- [빠른 시작](./quick-start.md)
- [API 레퍼런스](./api-reference.md)
- [아키텍처 개요](./01_architecture_overview.md)
- [중앙 매니저](./02_central_manager.md)
- [라우팅 및 격리 슬롯](./03_apartment_routing.md)
- [Manifest 서비스](./04_manifest_service.md)
- [디자인 토큰](./05_design_tokens.md)
- [컨테이너 생명주기](./06_container_lifecycle.md)
- [상태 관리](./07_state_management.md)
- [관측성](./08_observability.md)
- [보안과 격리](./09_security_isolation.md)
- [CI/CD](./10_cicd_pipeline.md)
- [마이그레이션](./11_migration_guide.md)
- [성능 최적화](./12_performance_optimization.md)
- [Docker/WASM 패키징](./docker-integration.md)
- [성능 메모](./performance.md)

## 이름에 대해

현재 이름인 `gaesup-store`는 상태 관리 관점에서는 자연스럽습니다. 다만 지금 범위는 store를 넘어 WASM 실행, manifest, 의존성 검증, 격리 정책까지 포함합니다. 장기적으로는 `gaesup-runtime`이 더 넓은 의미를 담기 좋습니다.
