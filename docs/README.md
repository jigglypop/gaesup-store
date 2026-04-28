# Gaesup-State 문서

이 문서는 Gaesup-State를 구현하거나 사용하는 사람이 전체 구조를 빠르게 잡을 수 있도록 정리한 문서입니다.

Gaesup-State는 일반 상태관리 라이브러리처럼 사용할 수 있지만, 내부 목표는 조금 더 넓습니다. Rust/WASM core가 상태를 관리하고, WASM 패키지는 manifest로 실행 계약을 선언합니다. host는 패키지를 실행하기 전에 ABI, dependency, store schema, accelerator 조건을 검증합니다.

## 한 문장으로

Gaesup-State는 프론트엔드에서 WASM 패키지를 컨테이너처럼 다루기 위한 상태관리 겸 실행 계약 런타임입니다.

## 핵심 개념

### Store

store는 `storeId`로 구분되는 상태 공간입니다. React, Vue, Svelte, Angular 같은 여러 프레임워크가 같은 store를 구독할 수 있습니다.

```typescript
await GaesupCore.createStore('orders', { count: 0 });
await GaesupCore.dispatch('orders', 'MERGE', { count: 1 });
const count = GaesupCore.select('orders', 'count');
```

store는 schema 정보를 가질 수 있습니다. schema는 WASM 패키지가 공유 상태에 붙어도 되는지 판단할 때 쓰입니다.

```typescript
await GaesupCore.createStore('orders', { items: [] }, {
  schema: {
    storeId: 'orders',
    schemaId: 'orders-state',
    schemaVersion: '1.2.0'
  }
});
```

### Manifest

WASM 패키지는 자신이 필요한 실행 조건을 manifest에 적습니다.

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

host는 이 manifest를 보고 실행 가능 여부를 결정합니다.

### Dependency isolation

의존성은 크게 두 종류입니다.

| source | 의미 |
| --- | --- |
| `host` | host가 제공하는 라이브러리 버전을 사용합니다. 버전 범위가 맞아야 실행됩니다. |
| `bundled` | 패키지 안에 포함된 라이브러리를 사용합니다. host 버전과 충돌하지 않습니다. |

예를 들어 host가 `chart.js@4.4.3`을 쓰고 있는데 어떤 패키지가 `chart.js@^3.9.0`을 요구하면, `source: 'host'`일 때는 차단해야 합니다. 하지만 `source: 'bundled'`라면 패키지 내부의 `chart.js@3`으로 실행할 수 있습니다.

이 방식의 목적은 단순합니다. 패키지가 host의 dependency graph를 몰래 바꾸거나, 다른 패키지의 런타임을 깨지 못하게 막습니다.

### Store schema isolation

패키지가 요구하는 store schema와 host store schema가 맞지 않으면 공유 상태에 붙이면 안 됩니다.

정책은 다음처럼 동작합니다.

| 정책 | 동작 |
| --- | --- |
| `reject` | 공유 store 접근을 막고 패키지 실행을 실패 처리합니다. |
| `isolate` | 공유 store 대신 격리된 namespace를 줍니다. |
| `readonly` | 읽기 전용 접근을 의도하는 정책입니다. enforcement는 별도 구현이 필요합니다. |
| `migrate` | schema migration을 의도하는 정책입니다. migration 구현이 없으면 실패 처리해야 합니다. |

현재 구현에서 가장 중요한 흐름은 `reject`와 `isolate`입니다. schema가 맞지 않는데 공유 store에 붙는 상황을 막는 것이 1차 목적입니다.

### Render state

R3F나 WebGPU 기반 화면에서는 상태 업데이트가 일반 UI보다 훨씬 자주 일어납니다. 매 프레임 React state를 바꾸면 reconciliation 비용이 커지고, JSON patch를 많이 만들면 직렬화와 객체 생성 비용이 커집니다.

Gaesup-State의 render runtime은 다음 흐름을 목표로 합니다.

1. 화면 전환과 transform state는 Rust WASM store가 들고 있습니다.
2. 프레임마다 바뀐 entity만 dirty로 표시합니다.
3. JS는 dirty matrix buffer만 받아서 R3F 또는 WebGPU buffer에 씁니다.

현재 브라우저 환경에서는 WebGPU와 Three.js API 호출 자체가 JS 경계를 지나야 합니다. 하지만 넘어가는 데이터를 typed array로 줄이면 비용을 크게 낮출 수 있습니다.

## Rust core 모듈

`packages/core-rust/src`는 다음 모듈로 나뉩니다.

| 파일 | 역할 |
| --- | --- |
| `lib.rs` | wasm-bindgen export와 모듈 entry point |
| `store.rs` | named store, dispatch, subscribe, snapshot, metrics |
| `compatibility.rs` | manifest, dependency, store schema, accelerator 검증 |
| `container.rs` | 컨테이너 생성, 정지, call, metrics |
| `render.rs` | render store, entity transform, screen transition, matrix buffer |
| `render_math.rs` | matrix composition과 렌더 수학 |

`lib.rs`는 되도록 얇게 유지하고, 기능은 각 모듈에 둡니다. 테스트도 모듈 가까이에 두어 Rust 쪽에서 바로 검증할 수 있게 합니다.

## 현재 구현 범위

- Rust WASM core 빌드
- native Rust 단위 테스트
- `wasm-pack` 기반 web/bundler/node package 생성
- TypeScript wrapper
- multi-framework demo
- dependency isolation demo
- render dirty matrix buffer fast path
- Containerfile 스타일 manifest 예시

아직 완전한 Docker-in-browser나 실제 CUDA 실행 엔진을 제공하는 것은 아닙니다. 브라우저 안에서는 Docker 컨테이너를 그대로 띄우는 것이 아니라, WASM 패키지를 컨테이너처럼 검증하고 격리하는 모델입니다. CUDA는 브라우저 직접 실행이 아니라 host/runtime이 제공하는 accelerator 계약으로 다룹니다.

## 확인 명령

```bash
pnpm run build:wasm
pnpm --filter @gaesup-state/core run build
pnpm --filter @gaesup-state/multi-framework-demo run build
```

Rust:

```bash
cd packages/core-rust
cargo test
cargo check --target wasm32-unknown-unknown --features wasm
```

데모:

```bash
pnpm --filter @gaesup-state/multi-framework-demo run dev -- --host 0.0.0.0
```

## 문서 목록

- [빠른 시작](./quick-start.md)
- [API 레퍼런스](./api-reference.md)
- [성능 메모](./performance.md)
- [Docker/WASM 패키징](./docker-integration.md)
- [Render runtime](./render-runtime.md)

## 심화 문서

- [아키텍처 개요](./01_architecture_overview.md)
- [중앙 관리자](./02_central_manager.md)
- [라우팅과 격리 영역](./03_apartment_routing.md)
- [Manifest 서비스](./04_manifest_service.md)
- [디자인 토큰](./05_design_tokens.md)
- [컨테이너 생명주기](./06_container_lifecycle.md)
- [상태관리](./07_state_management.md)
- [관측성](./08_observability.md)
- [보안과 격리](./09_security_isolation.md)
- [CI/CD 파이프라인](./10_cicd_pipeline.md)
- [마이그레이션 가이드](./11_migration_guide.md)
- [성능 최적화](./12_performance_optimization.md)
