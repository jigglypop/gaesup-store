# API 레퍼런스

이 문서는 현재 TypeScript wrapper에서 노출하는 API를 기준으로 정리합니다.

```typescript
import {
  GaesupCore,
  CompatibilityGuard,
  ContainerManager,
  GaesupRender,
  GaesupRenderBridge
} from '@gaesup-state/core';
```

## 초기화

대부분의 async API는 내부에서 WASM 초기화를 보장합니다.

```typescript
await GaesupCore.createStore('main', {});
```

동기 API인 `select`, `subscribe`, `CompatibilityGuard.validate`를 먼저 호출해야 한다면 초기화를 명시합니다.

```typescript
import { initGaesupCore } from '@gaesup-state/core';

await initGaesupCore();
```

## GaesupCore

### createStore

```typescript
await GaesupCore.createStore(storeId, initialState, options);
```

store를 생성합니다.

```typescript
await GaesupCore.createStore('orders', { items: [] }, {
  schema: {
    storeId: 'orders',
    schemaId: 'orders-state',
    schemaVersion: '1.2.0'
  }
});
```

### cleanupStore

```typescript
await GaesupCore.cleanupStore('orders');
```

store와 JS dispatch listener를 정리합니다.

### garbageCollect

```typescript
await GaesupCore.garbageCollect();
```

store, container, dispatch listener를 정리합니다. 테스트나 demo reset에 유용합니다.

### dispatch

```typescript
await GaesupCore.dispatch('orders', 'MERGE', { count: 1 });
```

지원하는 기본 action type은 Rust core 구현을 따릅니다.

| action | 용도 |
| --- | --- |
| `SET` | store 전체 교체 |
| `MERGE` | object merge |
| `UPDATE` | 특정 path 갱신 |
| `DELETE` | 특정 path 삭제 |
| `BATCH` | 여러 update 묶음 |

legacy 형태도 지원합니다.

```typescript
await GaesupCore.dispatch('MERGE', { count: 1 });
```

이 경우 storeId는 `main`으로 처리됩니다.

### dispatchCounter

```typescript
await GaesupCore.dispatchCounter('shared', 1, 'react', 'INCREMENT');
```

카운터 demo처럼 구조가 고정된 업데이트를 위한 fast path입니다.

### dispatchCounterBatch

```typescript
await GaesupCore.dispatchCounterBatch('shared', 1, 1000, 'benchmark', 'INCREMENT');
```

같은 counter update를 Rust 안에서 batch 처리합니다. JS/WASM 경계를 반복해서 넘지 않으므로 벤치마크와 대량 업데이트에 유리합니다.

### dispatchCounterFast

```typescript
const nextCount = await GaesupCore.dispatchCounterFast('shared', 1);
```

`count` 필드만 in-place로 갱신하고 새 count 숫자만 반환합니다. history, framework, lastUpdated 같은 demo metadata를 만들지 않으므로 단일 counter update가 훨씬 가볍습니다.

### dispatchCounterBatchFast

```typescript
const nextCount = await GaesupCore.dispatchCounterBatchFast('shared', 1, 1000);
```

1000개 논리 increment를 Rust 안에서 한 번에 처리하고 새 count 숫자만 반환합니다. 벤치마크와 고빈도 counter update에는 이 경로가 가장 빠릅니다.

### counter handle fast path

```typescript
const handle = await GaesupCore.createCounterHandle('shared');

const nextCount = await GaesupCore.dispatchCounterHandleFast(handle, 1);
const batchCount = await GaesupCore.dispatchCounterHandleBatchFast(handle, 1, 1000);

GaesupCore.releaseCounterHandle(handle);
```

counter handle은 `storeId` 문자열 lookup을 줄이고 Rust 내부 counter lane을 직접 갱신합니다. `select('shared', 'count')`는 lane 값을 읽기 때문에 최신 count와 어긋나지 않습니다. 전체 state가 필요하면 lane 값이 store state로 flush됩니다.

검증이 끝난 핸들을 아주 뜨거운 루프에서 재사용할 때는 unchecked 경로를 쓸 수 있습니다.

```typescript
const nextCount = GaesupCore.dispatchCounterHandleFastUnchecked(handle, 1);
```

unchecked 경로는 없는 handle을 넘겼을 때 안전한 error를 만들지 않습니다. 일반 앱 코드에서는 checked handle API를 우선 사용하세요.

### select

```typescript
const fullState = GaesupCore.select('orders', '');
const count = GaesupCore.select('orders', 'count');
```

빈 path는 전체 store를 반환합니다.

### subscribe

```typescript
GaesupCore.registerCallback('orders-listener', (state) => {
  console.log(state);
});

const subscriptionId = GaesupCore.subscribe('orders', '', 'orders-listener');
```

callback 함수를 직접 넘길 수도 있습니다.

```typescript
const subscriptionId = GaesupCore.subscribe('orders', '', (state) => {
  console.log(state);
});
```

정리:

```typescript
GaesupCore.unsubscribe(subscriptionId);
GaesupCore.unregisterCallback('orders-listener');
```

### snapshot

```typescript
const snapshotId = await GaesupCore.createSnapshot('orders');
await GaesupCore.restoreSnapshot('orders', snapshotId);
```

store 상태를 저장하고 복구합니다.

### metrics

```typescript
const metrics = await GaesupCore.getMetrics('orders');
```

대표 필드:

| 필드 | 의미 |
| --- | --- |
| `subscriber_count` | 구독자 수 |
| `total_selects` | select 호출 수 |
| `total_updates` | 상태 update 수 |
| `total_dispatches` | dispatch 호출 수 |
| `avg_dispatch_time` | 평균 dispatch 시간 |
| `memory_usage` | 추정 메모리 사용량 |

### store schema

```typescript
GaesupCore.registerStoreSchema({
  storeId: 'orders',
  schemaId: 'orders-state',
  schemaVersion: '1.2.0'
});

const schemas = GaesupCore.getStoreSchemas();
```

schema는 `CompatibilityGuard`가 manifest의 store 계약을 검증할 때 사용합니다.

### createBatchUpdate

```typescript
const batch = GaesupCore.createBatchUpdate('orders');
batch.addUpdate('MERGE', { count: 1 });
batch.addUpdate('MERGE', { updatedBy: 'batch' });
const state = batch.execute();
```

여러 update를 묶어 실행합니다.

### onDispatch

```typescript
const off = GaesupCore.onDispatch('orders', (action, state) => {
  console.log(action, state);
});

off();
```

TypeScript wrapper 레벨의 dispatch listener입니다.

## CompatibilityGuard

host가 제공하는 계약과 패키지 manifest를 비교합니다.

```typescript
const guard = new CompatibilityGuard({
  abiVersion: '1.0.0',
  defaultConflictPolicy: 'reject',
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
  ],
  accelerators: [
    {
      kind: 'webgpu',
      version: '1.0.0',
      capabilities: ['shader-f16']
    }
  ]
});

const result = guard.validate(manifest);
```

결과:

| 필드 | 의미 |
| --- | --- |
| `valid` | 실행 가능 여부 |
| `errors` | 실행을 막아야 하는 문제 |
| `warnings` | 실행은 가능하지만 표시할 정보 |
| `isolatedStores` | 공유 store 대신 격리해야 하는 store |

정적 호출도 가능합니다.

```typescript
const result = CompatibilityGuard.validate(manifest, hostConfig);
```

### package dependency

```typescript
dependencies: [
  { name: 'date-fns', version: '^2.29.0', source: 'host' },
  { name: 'chart.js', version: '^3.9.0', source: 'bundled' }
]
```

- `host`: host가 제공하는 버전을 사용합니다. 버전이 맞지 않으면 error입니다.
- `bundled`: 패키지 내부 버전을 사용합니다. host 버전과 충돌하지 않습니다.

### store dependency

```typescript
stores: [
  {
    storeId: 'orders',
    schemaId: 'orders-state',
    schemaVersion: '^1.2.0',
    conflictPolicy: 'reject'
  }
]
```

schema가 맞지 않을 때 `reject`는 차단, `isolate`는 격리 실행을 의미합니다.

### accelerator dependency

```typescript
accelerators: [
  { kind: 'cuda', version: '>=12.0.0', capabilities: ['sm_80'] },
  { kind: 'webgpu', version: '>=1.0.0', capabilities: ['shader-f16'] }
]
```

브라우저가 CUDA를 직접 실행한다는 뜻이 아닙니다. host/runtime이 CUDA 실행 경로를 제공하는 경우, 패키지가 어떤 accelerator를 요구하는지 검증하기 위한 계약입니다.

## ContainerManager

현재 ContainerManager는 Rust container registry와 lifecycle API를 감싼 얇은 wrapper입니다.

```typescript
const manager = new ContainerManager();

const container = await manager.createContainer({
  name: 'orders-widget',
  initialState: { ready: true }
});
```

### ContainerInstance

```typescript
container.getId();
container.getStatus();
container.getState();
container.getMetrics();
await container.call('render', { id: 1 });
await container.stop();
```

### manager methods

```typescript
const id = await manager.run('orders-widget');
const instance = manager.getContainer(id);
const list = manager.listContainers();
await manager.cleanup();
```

event listener:

```typescript
const off = manager.on('container:created', (event) => {
  console.log(event.containerId);
});

off();
```

## GaesupRender

render runtime은 R3F/WebGPU 같은 고빈도 화면 갱신을 위해 추가된 API입니다.

### createStore

```typescript
await GaesupRender.createStore('scene', 'home');
```

render store를 만들고 초기 screen을 지정합니다.

### createEntity

```typescript
const entityId = await GaesupRender.createEntity('scene', {
  instanceIndex: 0,
  transform: {
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1]
  },
  materialId: 'default',
  meshId: 'cube',
  visible: true
});
```

`instanceIndex`는 instanced rendering에서 matrix 위치를 맞추는 데 사용합니다.

### setTransform

```typescript
await GaesupRender.setTransform('scene', entityId, {
  position: [1, 0, 0],
  rotation: [0, Math.PI / 2, 0],
  scale: [1, 1, 1]
});
```

### rotateY

```typescript
await GaesupRender.rotateY('scene', entityId, 0.016);
```

Y축 회전을 누적합니다.

### beginScreenTransition

```typescript
await GaesupRender.beginScreenTransition('scene', 'detail', 300, 'ease-out');
```

화면 전환 상태를 render store에 기록합니다.

### tickFrame

```typescript
const patches = await GaesupRender.tickFrame('scene', 16.6);
```

JSON patch 중심의 debug/호환 경로입니다. 사람이 읽기 쉽지만 대량 entity에는 typed buffer보다 느립니다.

### tickFrameState

```typescript
const frameState = await GaesupRender.tickFrameState('scene', 16.6);
```

typed dirty buffer와 함께 쓰기 위한 fast path입니다.

### getMatrixBuffer

```typescript
const buffer = GaesupRender.getMatrixBuffer('scene');
const matrices = new Float32Array(buffer.matrices);
```

전체 entity matrix buffer를 가져옵니다.

### getDirtyMatrixBuffer

```typescript
const dirty = GaesupRender.getDirtyMatrixBuffer('scene');
```

반환 형태:

```typescript
{
  count: number;
  instanceIndices: Uint32Array;
  matrices: Float32Array;
}
```

바뀐 entity만 GPU buffer 또는 instanced mesh에 반영할 때 사용합니다.

### benchmark

```typescript
const full = await GaesupRender.benchmarkMatrixBuffer(10000);
const dirty = await GaesupRender.benchmarkDirtyMatrixBuffer(10000, 1000);
```

렌더 fast path 성능을 대략 확인하는 API입니다.

### cleanup

```typescript
GaesupRender.cleanup('scene');
```

render store를 정리합니다.

## GaesupRenderBridge

`GaesupRenderBridge`는 Rust render state와 Three.js/R3F/WebGPU buffer 사이를 연결합니다.

```typescript
const bridge = new GaesupRenderBridge({
  storeId: 'scene',
  patchMode: 'typed'
});
```

`patchMode` 기본값은 typed fast path입니다. `json`으로 지정하면 `tickFrame` JSON patch를 적용합니다.

### bindObject

```typescript
bridge.bindObject(entityId, object3d);
```

일반 `Object3D`에 matrix patch를 적용할 때 사용합니다.

### bindInstancedWriter

```typescript
bridge.bindInstancedWriter({
  writeDirtyMatrices(indices, matrices) {
    // indices와 matrices를 instanced mesh 또는 GPU buffer에 씁니다.
  }
});
```

가능하면 `writeDirtyMatrices`를 제공하는 것이 가장 좋습니다. 없으면 bridge는 `setMatrixAt` fallback을 사용합니다.

### tick

```typescript
const result = await bridge.tick(16.6);
```

typed mode에서는 내부적으로 `tickFrameState`를 호출한 뒤 dirty matrix buffer를 동기화합니다.

### WebGPU buffer 연결

```typescript
const bridge = new GaesupRenderBridge({
  storeId: 'scene',
  gpuDevice: device,
  matrixBuffer,
  matrixStrideBytes: 64
});
```

dirty matrix마다 `device.queue.writeBuffer`를 호출합니다. entity가 많아지면 이후 단계에서 write range batching을 적용할 수 있습니다.
