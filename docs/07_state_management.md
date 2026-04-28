# 상태관리

Gaesup-State의 상태관리는 Rust/WASM core에 named store를 만들고, 여러 프레임워크가 같은 store를 구독하는 방식입니다.

## store 생성

```typescript
await GaesupCore.createStore('shared', {
  count: 0,
  updatedBy: null
});
```

schema가 필요한 store는 생성 시점에 같이 등록합니다.

```typescript
await GaesupCore.createStore('orders', { items: [] }, {
  schema: {
    storeId: 'orders',
    schemaId: 'orders-state',
    schemaVersion: '1.2.0'
  }
});
```

## 읽기

```typescript
const full = GaesupCore.select('orders', '');
const items = GaesupCore.select('orders', 'items');
```

빈 path는 전체 store를 반환합니다.

## 쓰기

```typescript
await GaesupCore.dispatch('orders', 'MERGE', {
  updatedAt: Date.now()
});
```

자주 쓰는 counter 업데이트는 전용 fast path를 사용할 수 있습니다.

```typescript
await GaesupCore.dispatchCounter('shared', 1, 'react', 'INCREMENT');
await GaesupCore.dispatchCounterBatch('shared', 1, 1000, 'benchmark', 'INCREMENT');
```

history나 framework metadata가 필요 없으면 fast path를 사용합니다.

```typescript
await GaesupCore.dispatchCounterFast('shared', 1);
await GaesupCore.dispatchCounterBatchFast('shared', 1, 1000);
```

## 구독

```typescript
GaesupCore.registerCallback('orders-listener', (state) => {
  console.log(state);
});

const subscriptionId = GaesupCore.subscribe('orders', '', 'orders-listener');
```

정리:

```typescript
GaesupCore.unsubscribe(subscriptionId);
GaesupCore.unregisterCallback('orders-listener');
```

## snapshot

```typescript
const snapshotId = await GaesupCore.createSnapshot('orders');
await GaesupCore.restoreSnapshot('orders', snapshotId);
```

snapshot은 테스트, undo/redo, demo reset 같은 흐름에 사용할 수 있습니다.

## store schema와 안전성

공유 store는 schema가 맞을 때만 패키지에 열어야 합니다. schema가 맞지 않는 패키지가 같은 store를 수정하면 상태 구조가 깨질 수 있습니다.

따라서 WASM 패키지를 실행하기 전에는 `CompatibilityGuard`로 store contract를 확인해야 합니다.
