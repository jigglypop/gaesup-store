# API 레퍼런스

이 문서는 현재 저장소에서 실제로 연결되어 있는 핵심 API를 정리합니다.

## Store API

```typescript
import { GaesupCore } from '@gaesup-state/core';
```

### createStore

```typescript
await GaesupCore.createStore(storeId, initialState, options?);
```

schema를 함께 등록할 수 있습니다.

```typescript
await GaesupCore.createStore('orders', { items: [] }, {
  schema: {
    storeId: 'orders',
    schemaId: 'orders-state',
    schemaVersion: '1.2.0'
  }
});
```

### select

```typescript
const fullState = GaesupCore.select('orders', '');
const items = GaesupCore.select('orders', 'items');
```

빈 path는 전체 store를 의미합니다.

### dispatch

```typescript
await GaesupCore.dispatch('orders', 'MERGE', { items: [] });
```

기본 action type:

- `SET`: 전체 상태 교체
- `MERGE`: 객체 부분 병합
- `UPDATE`: 특정 path 값 변경
- `DELETE`: 특정 path 삭제
- `BATCH`: 여러 업데이트 묶음 실행

### subscribe

```typescript
const callbackId = 'orders-listener';

GaesupCore.registerCallback(callbackId, () => {
  console.log(GaesupCore.select('orders', ''));
});

const subscriptionId = GaesupCore.subscribe('orders', '', callbackId);
```

정리:

```typescript
GaesupCore.unsubscribe(subscriptionId);
GaesupCore.unregisterCallback(callbackId);
```

중요: callback은 `subscribe`보다 먼저 등록해야 합니다.

### snapshot

```typescript
const snapshotId = await GaesupCore.createSnapshot('orders');
await GaesupCore.restoreSnapshot('orders', snapshotId);
```

### metrics

```typescript
const metrics = await GaesupCore.getMetrics('orders');
```

대표 필드:

- `subscriber_count`
- `total_selects`
- `total_updates`
- `total_dispatches`
- `avg_dispatch_time`
- `memory_usage`

## Store schema API

```typescript
GaesupCore.registerStoreSchema({
  storeId: 'orders',
  schemaId: 'orders-state',
  schemaVersion: '1.2.0'
});

const schemas = GaesupCore.getStoreSchemas();
```

schema 정보는 container manifest의 store dependency와 비교됩니다.

## Container manifest

```typescript
import type { ContainerPackageManifest } from '@gaesup-state/core';

const manifest: ContainerPackageManifest = {
  manifestVersion: '1.0',
  name: 'orders-widget',
  version: '1.0.0',
  gaesup: { abiVersion: '^1.0.0' },
  dependencies: [
    { name: 'date-fns', version: '^2.29.0', source: 'host' },
    { name: 'chart.js', version: '^3.9.0', source: 'bundled' }
  ],
  stores: [
    {
      storeId: 'orders',
      schemaId: 'orders-state',
      schemaVersion: '^1.2.0',
      conflictPolicy: 'reject'
    }
  ],
  allowedImports: ['env.memory'],
  permissions: {
    network: false,
    storage: 'scoped'
  }
};
```

`source` 의미:

- `host`: host가 제공하는 의존성을 사용합니다. 버전이 맞아야 합니다.
- `bundled`: 컨테이너가 의존성을 함께 패키징합니다. host 버전과 충돌하지 않습니다.

## CompatibilityGuard

```typescript
import { CompatibilityGuard } from '@gaesup-state/core';

const guard = new CompatibilityGuard({
  abiVersion: '1.0.0',
  dependencies: [
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

const decision = guard.validate(manifest);
```

검증 결과:

- `decision.valid`: 실행 가능 여부
- `decision.errors`: 차단해야 하는 문제
- `decision.warnings`: 실행은 가능하지만 표시할 정보
- `decision.isolatedStores`: 격리 store로 실행해야 하는 store 목록
- `decision.readonlyStores`: 읽기 전용으로 다뤄야 하는 store 목록

## ContainerManager

```typescript
import { ContainerManager } from '@gaesup-state/core';

const manager = new ContainerManager({
  defaultRuntime: 'browser',
  compatibility: {
    abiVersion: '1.0.0',
    dependencies: [],
    stores: []
  }
});
```

실행:

```typescript
const container = await manager.run('orders-widget:1.0.0', {
  runtime: 'browser',
  manifest
});
```

`ContainerManager`는 WASM 인스턴스 생성 전에 manifest를 검증합니다. 검증 실패 시 컨테이너는 실행되지 않습니다.
