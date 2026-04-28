# Gaesup-State

Gaesup-State는 프론트엔드에서 Rust WASM 코어를 기반으로 여러 프레임워크가 같은 상태를 공유하고, WASM 패키지를 컨테이너처럼 검증해서 실행하기 위한 런타임입니다.

핵심 목표는 단순한 전역 상태 관리가 아닙니다. 패키지가 어떤 의존성, 어떤 ABI, 어떤 store schema, 어떤 GPU 가속기 계약을 요구하는지 manifest로 선언하고, host가 실행 전에 이를 검증합니다. 상태는 React, Vue, Svelte, Angular 어댑터가 같은 Rust WASM store를 구독하는 방식으로 공유됩니다.

## 현재 상태

현재 저장소에서 동작하는 주요 범위는 다음과 같습니다.

- Rust WASM 기반 named store 코어
- `createStore`, `dispatch`, `select`, `subscribe`, `snapshot`, `metrics`
- React, Vue, Svelte, Angular 어댑터
- WASM 컨테이너 manifest 타입
- host 의존성과 bundled 의존성 검증
- store schema 충돌 검증과 격리 정책
- CUDA/WebGPU accelerator 계약 검증
- Containerfile 스타일 WASM 패키징 빌더
- 두 페이지로 구성된 멀티 프레임워크 데모

## 왜 필요한가

프론트엔드 애플리케이션이 커지면 다음 문제가 자주 생깁니다.

- 프레임워크별로 상태 복사본이 생겨 같은 값이 서로 다르게 보임
- 패키지별 의존성 버전이 host 의존성과 충돌함
- store schema가 맞지 않는데 같은 전역 상태에 붙어 상태가 깨짐
- WASM 패키지가 어떤 권한과 런타임 기능을 요구하는지 실행 전에는 알기 어려움
- GPU 가속이 필요한 패키지가 host/runtime의 CUDA 또는 WebGPU 지원 여부를 확인하지 못함

Gaesup-State는 이 문제를 다음 방식으로 풉니다.

- store 실행은 Rust WASM 코어가 담당합니다.
- 프레임워크 어댑터는 같은 store를 구독합니다.
- 컨테이너 manifest는 ABI, 의존성, 권한, store schema, accelerator 요구사항을 선언합니다.
- host는 `CompatibilityGuard`로 manifest를 먼저 검증합니다.
- 충돌하는 라이브러리는 컨테이너 내부에 bundled dependency로 패키징할 수 있습니다.
- store schema가 맞으면 공유 store를 쓰고, 맞지 않으면 정책에 따라 차단하거나 격리합니다.

## 빠른 시작

```bash
corepack enable
corepack prepare pnpm@8.10.0 --activate
pnpm install
pnpm run build:wasm
pnpm --filter @gaesup-state/core run build
pnpm --filter @gaesup-state/multi-framework-demo run dev -- --host 0.0.0.0
```

브라우저에서 다음 주소를 엽니다.

```text
http://localhost:3000/
```

데모는 두 페이지로 구성됩니다.

1. 공유 카운터
   React, Vue, Svelte, Angular-like 카드가 같은 Rust WASM store를 구독합니다. 어느 카드에서 `+1`을 눌러도 네 카드의 count가 함께 올라가야 합니다.

2. 의존성 격리
   host 의존성 공유, bundled dependency 실행, store schema 격리, CUDA accelerator 계약, host 의존성 충돌 차단을 확인합니다.

## 기본 사용

```typescript
import { GaesupCore } from '@gaesup-state/core';

await GaesupCore.createStore('orders', { count: 0 });

await GaesupCore.dispatch('orders', 'MERGE', { count: 1 });

const count = GaesupCore.select('orders', 'count');
```

구독은 callback을 등록한 뒤 store에 연결합니다.

```typescript
GaesupCore.registerCallback('orders-listener', (state) => {
  console.log(state);
});

const subscriptionId = GaesupCore.subscribe('orders', '', 'orders-listener');

GaesupCore.unsubscribe(subscriptionId);
GaesupCore.unregisterCallback('orders-listener');
```

## Manifest 예시

```typescript
const manifest = {
  manifestVersion: '1.0',
  name: 'analytics-widget',
  version: '1.0.0',
  gaesup: { abiVersion: '^1.0.0' },
  dependencies: [
    { name: 'date-fns', version: '^2.29.0', source: 'host' },
    { name: 'chart.js', version: '^3.9.0', source: 'bundled' }
  ],
  stores: [
    {
      storeId: 'analytics',
      schemaId: 'analytics-state',
      schemaVersion: '^2.0.0',
      conflictPolicy: 'reject'
    }
  ],
  accelerators: [
    { kind: 'cuda', version: '>=12.0.0', capabilities: ['sm_80'] }
  ],
  allowedImports: ['env.memory', 'env.gpu.cuda'],
  permissions: {
    network: false,
    storage: 'scoped'
  }
};
```

`source`가 `host`이면 host가 제공하는 의존성과 버전이 맞아야 합니다. `source`가 `bundled`이면 컨테이너가 의존성을 함께 패키징하므로 host 의존성 그래프를 바꾸지 않습니다.

CUDA는 브라우저가 직접 실행하는 기능이 아닙니다. Gaesup-State에서 CUDA 지원은 host/runtime이 CUDA 실행 계층을 제공하고, 컨테이너가 그 요구사항을 manifest로 선언한다는 뜻입니다.

## Containerfile 예시

```dockerfile
FROM scratch
ABI 1.0
DEPENDENCY onnxruntime-gpu ^1.18.0 bundled
ACCELERATOR cuda >=12.0.0 sm_80 tensor-cores
STORE analytics analytics-state ^2.0.0 reject
IMPORT env.memory env.gpu.cuda
```

## 패키지 구조

```text
gaesup-state/
├── packages/
│   ├── core/                 # TypeScript API와 container compatibility
│   ├── core-rust/            # Rust WASM store core
│   ├── adapter/              # 공통 어댑터 계층
│   └── frameworks/
│       ├── react/
│       ├── vue/
│       ├── svelte/
│       └── angular/
├── tools/
│   └── container-builder/    # WASM 컨테이너 manifest 빌더
├── examples/
│   └── multi-framework-demo/
├── docs/
└── docker/
```

## 주요 명령

```bash
pnpm run build:wasm
pnpm --filter @gaesup-state/core run build
pnpm --filter @gaesup-state/core exec vitest run src/__tests__/core.test.ts
pnpm --filter @gaesup-state/multi-framework-demo run build
pnpm --filter @gaesup-state/container-builder run build
```

## 문서

- [문서 홈](./docs/README.md)
- [빠른 시작](./docs/quick-start.md)
- [API 레퍼런스](./docs/api-reference.md)
- [Docker/WASM 패키징](./docs/docker-integration.md)
- [성능 메모](./docs/performance.md)

## 이름

현재 저장소 이름은 `gaesup-store`이지만, 기능 범위는 store를 넘어 WASM runtime, manifest 검증, dependency isolation, accelerator contract까지 포함합니다. 장기적으로는 `gaesup-runtime`이 더 넓은 의미를 담기 좋습니다.

## 라이선스

MIT License
