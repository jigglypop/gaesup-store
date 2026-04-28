# Gaesup-State 문서

이 문서는 Gaesup-State를 구현하거나 사용하는 사람이 전체 구조를 빠르게 잡을 수 있도록 정리한 문서입니다.

Gaesup-State는 일반 상태관리 라이브러리처럼 사용할 수 있지만 목표는 더 넓습니다. Rust/WASM core가 상태를 관리하고, WASM 패키지는 manifest로 실행 계약을 선언합니다. host는 패키지를 실행하기 전에 ABI, dependency, store schema, accelerator 조건을 검증합니다.

## 한 문장으로

Gaesup-State는 프론트엔드에서 WASM 패키지를 컨테이너처럼 다루기 위한 상태관리 겸 실행 계약 런타임입니다.

## 핵심 개념

### Store

store는 `storeId`로 구분하는 상태 공간입니다. React, Vue, Svelte, Angular 같은 여러 프레임워크가 같은 store를 구독할 수 있습니다.

```typescript
await GaesupCore.createStore('orders', { count: 0 });
await GaesupCore.dispatch('orders', 'MERGE', { count: 1 });
const count = GaesupCore.select('orders', 'count');
```

store는 schema 정보를 가질 수 있습니다. schema는 WASM 패키지가 공유 상태에 붙어도 되는지 판단하는 계약입니다.

```typescript
await GaesupCore.createStore('orders', { items: [] }, {
  schema: {
    storeId: 'orders',
    schemaId: 'orders-state',
    schemaVersion: '1.2.0'
  }
});
```

### Auto store

일반 UI 상태는 `gaesup`으로 짧게 쓸 수 있습니다. 객체를 직접 수정하면 변경 path가 추적되고 Rust store에 patch가 반영됩니다.

```typescript
const counter = gaesup({
  count: 0,
  user: { name: 'Ada' }
});

counter.count += 1;
counter.user.name = 'Grace';
```

`watch`는 selector가 읽은 path만 의존성으로 추적합니다. API 상태는 `resource` 또는 `query`로 같은 store 모델 안에서 다룰 수 있습니다.

```typescript
const todos = resource('todos', fetchTodos);

await todos.refetch();
await todos.mutate((previous = []) => [...previous, optimisticTodo]);
```

자세한 내용은 [Auto store](./auto-store.md)를 보세요.

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
| `host` | host가 제공하는 라이브러리 버전을 사용합니다. 버전 범위가 맞아야 실행합니다. |
| `bundled` | 패키지 안에 포함된 라이브러리를 사용합니다. host 버전과 충돌하지 않습니다. |

예를 들어 host가 `chart.js@4.4.3`을 갖고 있는데 어떤 패키지가 `chart.js@^3.9.0`을 요구하면, `source: 'host'`일 때는 차단해야 합니다. 하지만 `source: 'bundled'`라면 패키지 내부의 `chart.js@3`으로 실행할 수 있습니다.

목적은 단순합니다. 패키지가 host dependency graph를 몰래 바꾸거나, 다른 패키지의 실행 계약을 깨지 못하게 막는 것입니다.

### Store schema isolation

패키지가 요구하는 store schema와 host store schema가 맞지 않으면 공유 상태에 붙이면 안 됩니다.

정책은 다음처럼 동작합니다.

| 정책 | 동작 |
| --- | --- |
| `reject` | 실행을 막습니다. |
| `isolate` | 공유 store 대신 컨테이너 전용 namespace를 줍니다. |
| `readonly` | 읽기 전용으로 붙이는 정책을 위한 예약값입니다. |
| `migrate` | schema migration을 위한 예약값입니다. |

### Render runtime

R3F/WebGPU 같은 3D 화면에서는 React 상태를 매 프레임 갱신하는 방식이 부담스럽습니다. Gaesup-State는 dirty matrix buffer와 render fast path를 통해 프레임마다 넘어가는 데이터를 줄이는 방향을 잡고 있습니다.

자세한 내용은 [Render runtime](./render-runtime.md)을 보세요.

## 빠른 실행

```bash
corepack enable
corepack prepare pnpm@8.10.0 --activate
pnpm install
pnpm run build:wasm
pnpm --filter gaesup-state run build
pnpm --filter @gaesup-state/multi-framework-demo run dev -- --host 0.0.0.0
```

브라우저에서 엽니다.

```text
http://localhost:3000/
```

## 문서 목록

- [빠른 시작](./quick-start.md)
- [API 레퍼런스](./api-reference.md)
- [Auto store](./auto-store.md)
- [Resource와 query](./resource-query.md)
- [Dispatch pipeline](./pipeline.md)
- [npm 배포 준비](./npm-publish.md)
- [성능 메모](./performance.md)
- [Docker/WASM 패키징](./docker-integration.md)
- [Render runtime](./render-runtime.md)

## 세부 문서

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

## 지금 읽는 순서

처음 보는 경우에는 이 순서가 가장 편합니다.

1. [빠른 시작](./quick-start.md)
2. [Auto store](./auto-store.md)
3. [Resource와 query](./resource-query.md)
4. [Dispatch pipeline](./pipeline.md)
5. [Docker/WASM 패키징](./docker-integration.md)
6. [성능 메모](./performance.md)
7. [Render runtime](./render-runtime.md)

## API 선택 기준

| 하고 싶은 일 | 먼저 볼 문서 |
| --- | --- |
| 객체를 직접 수정하는 상태관리 | [Auto store](./auto-store.md) |
| React Query 같은 API 상태를 store와 같이 관리 | [Resource와 query](./resource-query.md) |
| 여러 dispatch를 한 번에 묶기 | [Dispatch pipeline](./pipeline.md) |
| WASM 패키지 의존성 격리 | [Docker/WASM 패키징](./docker-integration.md) |
| R3F/WebGPU 화면 갱신 | [Render runtime](./render-runtime.md) |
| Zustand/Jotai/Redux와 속도 비교 | [성능 메모](./performance.md) |
