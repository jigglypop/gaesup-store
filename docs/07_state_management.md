# 상태 관리

Gaesup-State의 상태는 이름 있는 store로 관리됩니다.

## 생성

```typescript
await GaesupCore.createStore('app', { count: 0 });
```

schema 포함:

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
GaesupCore.select('orders', '');
GaesupCore.select('orders', 'items');
```

## 쓰기

```typescript
await GaesupCore.dispatch('orders', 'MERGE', { items: [] });
await GaesupCore.dispatch('orders', 'UPDATE', { path: 'items', value: [] });
await GaesupCore.dispatch('orders', 'SET', { items: [] });
```

## 구독

```typescript
GaesupCore.registerCallback('listener', () => {
  console.log(GaesupCore.select('orders', ''));
});

const id = GaesupCore.subscribe('orders', '', 'listener');
```

구독 해제:

```typescript
GaesupCore.unsubscribe(id);
GaesupCore.unregisterCallback('listener');
```
