# 마이그레이션 가이드

## 기존 framework state에서 이동

기존:

```typescript
const [count, setCount] = useState(0);
```

Gaesup store:

```typescript
await GaesupCore.createStore('counter', { count: 0 });
await GaesupCore.dispatch('counter', 'MERGE', { count: 1 });
```

여러 프레임워크가 같은 `counter` store를 구독할 수 있습니다.

## Redux/Zustand에서 이동

slice 단위로 store id를 정합니다.

```text
counter slice -> counter store
session slice -> session store
orders slice -> orders store
```

## Container 연결 전 schema 등록

```typescript
GaesupCore.registerStoreSchema({
  storeId: 'orders',
  schemaId: 'orders-state',
  schemaVersion: '1.2.0'
});
```

## Manifest에 store 계약 추가

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

schema가 맞지 않는 새 패키지는 `isolate` 정책으로 별도 store namespace에서 먼저 실행해볼 수 있습니다.
