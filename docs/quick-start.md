# 빠른 시작

이 문서는 로컬에서 Gaesup-State를 빌드하고 데모를 실행한 뒤, 기본 store와 manifest 검증을 사용하는 흐름까지 설명합니다.

## 준비물

- Node.js 18 이상
- pnpm 8 이상
- Rust stable
- `wasm32-unknown-unknown` target
- `wasm-pack`

Windows PowerShell에서 Rust 명령이 잡히지 않으면 현재 터미널에 cargo 경로를 추가합니다.

```powershell
$env:PATH="$env:USERPROFILE\.cargo\bin;$env:PATH"
```

pnpm은 corepack으로 맞추는 편이 가장 편합니다.

```bash
corepack enable
corepack prepare pnpm@8.10.0 --activate
```

## 설치

```bash
pnpm install
```

Rust target과 wasm-pack이 없다면 설치합니다.

```bash
rustup target add wasm32-unknown-unknown
cargo install wasm-pack
```

## WASM core 빌드

```bash
pnpm run build:wasm
```

이 명령은 `packages/core-rust`에서 세 가지 출력물을 만듭니다.

| 출력 | 용도 |
| --- | --- |
| `pkg` | bundler target |
| `pkg-web` | browser web target |
| `pkg-node` | Node.js target |

TypeScript wrapper는 현재 `pkg-web`의 WASM 모듈을 사용합니다.

## TypeScript 패키지 빌드

```bash
pnpm --filter gaesup-state run build
```

전체 패키지를 빌드하려면 다음 명령을 씁니다.

```bash
pnpm run build
```

## 데모 실행

```bash
pnpm --filter @gaesup-state/multi-framework-demo run dev -- --host 0.0.0.0
```

브라우저에서 엽니다.

```text
http://localhost:3000/
```

확인할 것:

- 공유 카운터 페이지에서 네 개 카드의 count가 같이 올라가는지 확인합니다.
- 의존성 격리 페이지에서 host 공유, bundled 실행, isolated store, blocked package가 각각 다르게 표시되는지 확인합니다.

## 기본 store 만들기

```typescript
import { GaesupCore } from 'gaesup-state';

await GaesupCore.createStore('shared', {
  count: 0,
  lastUpdatedBy: null
});
```

값을 바꿉니다.

```typescript
await GaesupCore.dispatch('shared', 'MERGE', {
  count: 1,
  lastUpdatedBy: 'react'
});
```

값을 읽습니다.

```typescript
const state = GaesupCore.select('shared', '');
const count = GaesupCore.select('shared', 'count');
```

빈 path는 전체 store를 반환합니다.

## 구독하기

```typescript
GaesupCore.registerCallback('shared-listener', (state) => {
  console.log('shared state changed', state);
});

const subscriptionId = GaesupCore.subscribe('shared', '', 'shared-listener');
```

정리할 때는 구독과 callback을 같이 해제합니다.

```typescript
GaesupCore.unsubscribe(subscriptionId);
GaesupCore.unregisterCallback('shared-listener');
```

## 빠른 counter path

일반 `dispatch`는 범용 상태 업데이트용입니다. 카운터처럼 자주 발생하고 구조가 정해진 업데이트는 전용 API를 쓰면 비용을 줄일 수 있습니다.

```typescript
await GaesupCore.dispatchCounter('shared', 1, 'react', 'INCREMENT');
```

벤치마크나 대량 갱신에는 batch API를 씁니다.

```typescript
await GaesupCore.dispatchCounterBatch('shared', 1, 1000, 'benchmark', 'INCREMENT');
```

metadata가 필요 없고 count만 빠르게 바꾸면 fast path를 씁니다.

```typescript
const nextCount = await GaesupCore.dispatchCounterFast('shared', 1);
const batchCount = await GaesupCore.dispatchCounterBatchFast('shared', 1, 1000);
```

프레임 루프나 벤치마크처럼 같은 store를 아주 자주 갱신하면 counter handle을 만들어 재사용합니다.

```typescript
const handle = await GaesupCore.createCounterHandle('shared');
await GaesupCore.dispatchCounterHandleFast(handle, 1);
await GaesupCore.dispatchCounterHandleBatchFast(handle, 1, 1000);
GaesupCore.releaseCounterHandle(handle);
```

## store schema 등록

패키지가 공유 store에 붙어도 되는지 판단하려면 host가 store schema를 알고 있어야 합니다.

```typescript
await GaesupCore.createStore('orders', { items: [] }, {
  schema: {
    storeId: 'orders',
    schemaId: 'orders-state',
    schemaVersion: '1.2.0'
  }
});
```

이미 store가 있다면 schema만 따로 등록할 수도 있습니다.

```typescript
GaesupCore.registerStoreSchema({
  storeId: 'orders',
  schemaId: 'orders-state',
  schemaVersion: '1.2.0'
});
```

## manifest 검증

```typescript
import { CompatibilityGuard } from 'gaesup-state';

const guard = new CompatibilityGuard({
  abiVersion: '1.0.0',
  dependencies: [
    { name: 'date-fns', version: '2.30.0' },
    { name: 'chart.js', version: '4.4.3' }
  ],
  stores: [
    {
      storeId: 'orders',
      schemaId: 'orders-state',
      schemaVersion: '1.2.0'
    }
  ]
});

const result = guard.validate({
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
});
```

`result.valid`가 `true`이면 host 계약과 맞습니다. `errors`가 있으면 실행을 막아야 합니다. `isolatedStores`에 store가 들어 있으면 공유 store 대신 격리 store로 실행해야 합니다.

## Render runtime 빠른 예시

```typescript
import { GaesupRender, GaesupRenderBridge } from 'gaesup-state';

await GaesupRender.createStore('scene', 'home');

const entityId = await GaesupRender.createEntity('scene', {
  instanceIndex: 0,
  transform: {
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1]
  }
});

const bridge = new GaesupRenderBridge({ storeId: 'scene' });

await GaesupRender.rotateY('scene', entityId, 0.016);
const { dirty } = await bridge.tick(16.6);
```

R3F `InstancedMesh`와 연결할 때는 `writeDirtyMatrices(indices, matrices)`를 가진 writer를 bridge에 연결하는 방식이 가장 빠릅니다.

```typescript
bridge.bindInstancedWriter({
  writeDirtyMatrices(indices, matrices) {
    for (let i = 0; i < indices.length; i++) {
      const matrix = matrices.subarray(i * 16, i * 16 + 16);
      // instanced mesh 또는 GPU buffer에 matrix를 씁니다.
    }
  }
});
```

## 자주 막히는 부분

### `wasm-pack`을 찾지 못함

```bash
cargo install wasm-pack
```

Windows에서는 새 터미널을 열거나 cargo 경로를 다시 잡습니다.

```powershell
$env:PATH="$env:USERPROFILE\.cargo\bin;$env:PATH"
```

### `Rust WASM core is not initialized yet`

`select`와 `subscribe`는 WASM 초기화 이후에 호출해야 합니다. 먼저 `createStore` 또는 `initGaesupCore()`를 `await` 하세요.

```typescript
import { initGaesupCore } from 'gaesup-state';

await initGaesupCore();
```

### 카운터가 공유되지 않음

확인할 것:

- 모든 카드가 같은 `storeId`를 쓰는지 확인합니다.
- 각 프레임워크가 자기 로컬 상태만 증가시키고 있지 않은지 확인합니다.
- `GaesupCore.subscribe` callback이 실제로 등록되어 있는지 확인합니다.
- demo dev server가 최신 WASM 빌드 이후 다시 켜졌는지 확인합니다.
