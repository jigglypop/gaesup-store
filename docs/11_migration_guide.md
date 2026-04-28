# 마이그레이션 가이드

이 문서는 기존 프론트엔드 상태관리 코드에서 Gaesup-State로 옮길 때의 순서를 설명합니다.

## 1. 공유해야 하는 상태만 고르기

모든 UI 상태를 Gaesup store에 넣을 필요는 없습니다.

Gaesup store에 적합한 값:

- 여러 프레임워크가 같이 봐야 하는 값
- WASM 패키지와 host가 공유해야 하는 값
- schema 계약이 필요한 도메인 상태
- snapshot이나 metrics가 필요한 상태

각 컴포넌트 내부에 남겨도 되는 값:

- input focus
- hover state
- 임시 form field
- 닫힘/열림 같은 로컬 UI 상태

## 2. storeId 정하기

```typescript
await GaesupCore.createStore('orders', initialOrdersState);
```

storeId는 도메인 기준으로 정하는 것이 좋습니다.

- `orders`
- `analytics`
- `checkout`
- `scene`

## 3. schema 등록

공유 store에 패키지가 붙는다면 schema를 등록합니다.

```typescript
GaesupCore.registerStoreSchema({
  storeId: 'orders',
  schemaId: 'orders-state',
  schemaVersion: '1.2.0'
});
```

## 4. 기존 update를 dispatch로 옮기기

기존 local update:

```typescript
setState((state) => ({ ...state, count: state.count + 1 }));
```

Gaesup update:

```typescript
await GaesupCore.dispatch('shared', 'MERGE', { count: nextCount });
```

카운터처럼 반복되는 작업은 전용 API를 고려합니다.

```typescript
await GaesupCore.dispatchCounter('shared', 1, 'react', 'INCREMENT');
```

## 5. 구독 연결

각 프레임워크 어댑터는 같은 store를 구독해야 합니다. demo에서는 네 카드가 같은 shared store를 바라보는지가 핵심입니다.

## 6. 패키지 manifest 추가

WASM 패키지를 붙일 때는 먼저 manifest를 작성합니다.

```typescript
dependencies: [
  { name: 'zod', version: '^3.20.0', source: 'host' }
],
stores: [
  { storeId: 'orders', schemaId: 'orders-state', schemaVersion: '^1.2.0' }
]
```

## 7. render state 분리

R3F나 WebGPU 화면은 일반 UI store와 render store를 분리하는 것이 좋습니다.

- UI filter, selected item: 일반 store
- transform, animation, screen transition: render store

이렇게 나누면 UI 리렌더와 프레임 업데이트가 서로 덜 간섭합니다.
