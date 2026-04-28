# Gaesup-State

Gaesup-State는 프론트엔드에서 여러 화면, 여러 프레임워크, 여러 WASM 패키지가 같은 상태를 안전하게 공유하도록 만드는 Rust/WASM 기반 런타임입니다.

처음에는 “React, Vue, Svelte, Angular가 같은 카운터를 같이 올리게 하자”에서 출발했지만, 지금 방향은 조금 더 큽니다. WASM 패키지를 브라우저 안의 작은 컨테이너처럼 다루고, 패키지가 요구하는 의존성, store schema, ABI, GPU/WebGPU 같은 실행 조건을 먼저 검증한 뒤 실행합니다.

사용자 입장에서는 일반 상태관리 라이브러리처럼 쓰면 됩니다. 내부에서는 Rust WASM 코어가 상태를 들고 있고, 프레임워크 어댑터와 렌더 브리지는 필요한 만큼만 JS 경계로 꺼냅니다.

## 지금 되는 것

- Rust/WASM 기반 named store
- `createStore`, `dispatch`, `select`, `subscribe`, `snapshot`, `metrics`
- React, Vue, Svelte, Angular 예제에서 하나의 store 공유
- WASM 패키지 manifest 검증
- host 의존성과 bundled 의존성 분리
- store schema 충돌 시 `reject` 또는 `isolate` 정책 적용
- CUDA/WebGPU 같은 accelerator 요구사항 검증 모델
- R3F/WebGPU를 염두에 둔 render state fast path
- dirty matrix buffer 기반 프레임 갱신
- Rust 단위 테스트와 WASM 빌드 경로

## 왜 필요한가

프론트엔드가 커지면 상태와 의존성이 같이 꼬입니다.

- 프레임워크별로 상태를 따로 들고 있어 같은 값이 다르게 보임
- 패키지 하나가 요구하는 라이브러리 버전이 host 버전과 충돌함
- store schema가 맞지 않는데 같은 전역 상태에 붙어서 상태가 깨짐
- WASM 패키지가 어떤 ABI, 권한, GPU 기능을 필요로 하는지 실행 전에는 알기 어려움
- R3F 같은 3D 화면에서 매 프레임 React 상태를 건드리면 렌더링 비용이 커짐

Gaesup-State는 이 문제를 세 가지로 나눠서 봅니다.

1. 상태는 Rust WASM core에 둔다.
2. 패키지는 manifest로 의존성과 store 계약을 선언한다.
3. 화면 갱신은 가능한 한 typed buffer로 처리해 JS 객체 생성과 JSON 직렬화를 줄인다.

## 빠른 실행

```bash
corepack enable
corepack prepare pnpm@8.10.0 --activate
pnpm install
pnpm run build:wasm
pnpm --filter @gaesup-state/core run build
pnpm --filter @gaesup-state/multi-framework-demo run dev -- --host 0.0.0.0
```

브라우저에서 엽니다.

```text
http://localhost:3000/
```

데모는 크게 두 흐름을 보여줍니다.

- 공유 카운터: React, Vue, Svelte, Angular 쪽 카드가 같은 Rust WASM store를 바라봅니다. 한 카드에서 `+1`을 누르면 다른 카드도 같이 올라가야 정상입니다.
- 의존성 격리: host dependency를 공유해도 되는 패키지, bundled dependency로 실행되는 패키지, store schema가 맞지 않아 격리되는 패키지, host 충돌로 차단되는 패키지를 확인합니다.

## 기본 사용법

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

카운터처럼 아주 자주 발생하는 업데이트는 전용 fast path를 쓸 수 있습니다.

```typescript
await GaesupCore.dispatchCounter('shared', 1, 'react', 'INCREMENT');
await GaesupCore.dispatchCounterBatch('shared', 1, 1000, 'benchmark', 'INCREMENT');
```

`history`, `framework`, `lastUpdated` 같은 demo metadata가 필요 없고 count만 빠르게 바꾸면 fast path를 씁니다.

```typescript
await GaesupCore.dispatchCounterFast('shared', 1);
await GaesupCore.dispatchCounterBatchFast('shared', 1, 1000);
```

더 뜨거운 루프에서는 counter handle을 만들어 `storeId` 문자열 lookup까지 줄일 수 있습니다.

```typescript
const handle = await GaesupCore.createCounterHandle('shared');
await GaesupCore.dispatchCounterHandleFast(handle, 1);
await GaesupCore.dispatchCounterHandleBatchFast(handle, 1, 1000);
```

## 의존성 격리 모델

WASM 패키지는 manifest에 필요한 의존성을 적습니다.

```typescript
const manifest = {
  manifestVersion: '1.0',
  name: 'legacy-report',
  version: '0.8.0',
  gaesup: { abiVersion: '^1.0.0' },
  dependencies: [
    { name: 'chart.js', version: '^3.9.0', source: 'bundled' }
  ],
  stores: [
    {
      storeId: 'analytics',
      schemaId: 'analytics-state',
      schemaVersion: '^2.0.0',
      conflictPolicy: 'reject'
    }
  ]
};
```

`source: 'host'`는 host가 제공하는 의존성을 쓰겠다는 뜻입니다. 이때 버전이 맞지 않으면 실행을 막습니다.

`source: 'bundled'`는 패키지 내부에 해당 의존성을 같이 넣겠다는 뜻입니다. host가 `chart.js@4`를 쓰고 있어도 패키지는 자기 안의 `chart.js@3`으로 실행될 수 있고, host dependency graph를 바꾸지 않습니다.

store schema도 같은 방식으로 검증합니다. schema가 맞으면 공유 store에 붙고, 맞지 않으면 정책에 따라 차단하거나 격리 namespace로 실행합니다. 그래서 “컨테이너 때문에 상태가 어긋나는” 상황을 실행 전에 막을 수 있습니다.

## Render와 R3F 방향

R3F에서는 React state를 매 프레임 건드리면 비용이 큽니다. Gaesup-State의 render runtime은 화면 전환과 object transform을 Rust WASM store에 두고, 프레임마다 바뀐 matrix만 typed buffer로 꺼내는 방향입니다.

```typescript
import { GaesupRender, GaesupRenderBridge } from '@gaesup-state/core';

await GaesupRender.createStore('scene', 'home');

const cubeId = await GaesupRender.createEntity('scene', {
  instanceIndex: 0,
  transform: {
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1]
  }
});

const bridge = new GaesupRenderBridge({ storeId: 'scene' });

await GaesupRender.rotateY('scene', cubeId, 0.016);
const frame = await bridge.tick(16.6);
```

현재 브라우저에서는 WebGPU/R3F 호출 자체가 JS API를 지나야 합니다. 그래서 “경계를 완전히 0으로 만든다”보다는 “매 프레임 넘어가는 데이터를 작고 일정하게 만든다”가 현실적인 목표입니다. dirty matrix buffer 경로는 이 목표에 맞춰 들어가 있습니다.

## 최근 성능 감

환경마다 수치는 달라질 수 있지만, 현재 fast path의 방향은 분명합니다.

| 작업 | 최근 측정 감 |
| --- | ---: |
| 개별 counter dispatch 1000회 | 수백 ms대 |
| counter fast update 1회 | 약 0.46us |
| counter handle update 1회 | 약 0.30us |
| counter handle unchecked update 1회 | 약 0.19us |
| counter handle batch 1000회 | 약 0.33us |
| render JSON patch 10,000개 | 약 70ms대 |
| render 전체 matrix buffer 10,000개 | 약 10ms대 후반 |
| dirty matrix buffer 1,000개 갱신 | 약 1ms대 |
| dirty matrix buffer 10,000개 갱신 | 약 2ms대 |

핵심은 Rust가 항상 마법처럼 빠르다는 뜻이 아닙니다. JSON 직렬화, JS 객체 생성, 프레임워크 리렌더가 병목이면 Rust로 옮겨도 느릴 수 있습니다. 그래서 자주 움직이는 경로는 batch, typed array, dirty update로 빼는 것이 중요합니다.

## 구조

```text
gaesup-store/
├─ packages/
│  ├─ core/              # TypeScript API wrapper
│  ├─ core-rust/         # Rust WASM core
│  ├─ adapter/           # framework 공통 연결부
│  └─ frameworks/
│     ├─ react/
│     ├─ vue/
│     ├─ svelte/
│     └─ angular/
├─ examples/
│  └─ multi-framework-demo/
├─ tools/
│  └─ container-builder/
├─ docs/
└─ docker/
```

Rust core는 모듈별로 나뉘어 있습니다.

- `store.rs`: 상태 저장소, dispatch, subscribe, snapshot, metrics
- `compatibility.rs`: manifest, dependency, store schema, accelerator 검증
- `container.rs`: 컨테이너 lifecycle과 call/metrics
- `render.rs`: render store, screen transition, dirty matrix buffer
- `render_math.rs`: matrix composition과 렌더 수학

## 주요 명령

```bash
pnpm run build:wasm
pnpm --filter @gaesup-state/core run build
pnpm --filter @gaesup-state/multi-framework-demo run build
```

Rust 쪽 확인:

```bash
cd packages/core-rust
cargo test
cargo check --target wasm32-unknown-unknown --features wasm
```

## 문서

- [문서 홈](./docs/README.md)
- [빠른 시작](./docs/quick-start.md)
- [API 레퍼런스](./docs/api-reference.md)
- [성능 메모](./docs/performance.md)
- [Docker/WASM 패키징](./docs/docker-integration.md)
- [Render runtime](./docs/render-runtime.md)

## 라이선스

MIT
