# 중앙 관리자

중앙 관리자의 역할은 앱 안에서 store, container, manifest 검증 흐름을 한곳에서 연결하는 것입니다.

현재 TypeScript API에서는 `GaesupCore`, `CompatibilityGuard`, `ContainerManager`가 이 역할을 나눠 맡습니다.

## GaesupCore

`GaesupCore`는 상태관리의 중심입니다.

```typescript
await GaesupCore.createStore('shared', { count: 0 });
await GaesupCore.dispatch('shared', 'MERGE', { count: 1 });
const state = GaesupCore.select('shared', '');
```

여러 프레임워크가 같은 `storeId`를 바라보면 같은 상태를 공유합니다.

## CompatibilityGuard

`CompatibilityGuard`는 host 계약과 패키지 manifest를 비교합니다.

```typescript
const guard = new CompatibilityGuard({
  abiVersion: '1.0.0',
  dependencies: [{ name: 'zod', version: '3.23.8' }],
  stores: [{ storeId: 'orders', schemaId: 'orders-state', schemaVersion: '1.2.0' }]
});

const result = guard.validate(manifest);
```

`result.valid`가 false이면 실행하지 않아야 합니다. `isolatedStores`에 store가 들어 있으면 공유 store가 아니라 격리 store를 써야 합니다.

## ContainerManager

`ContainerManager`는 컨테이너 lifecycle을 다룹니다.

```typescript
const manager = new ContainerManager();
const container = await manager.createContainer({ name: 'orders-widget' });

await container.call('render', {});
await container.stop();
```

현재 구현은 컨테이너 registry와 call/metrics 흐름을 제공하는 얇은 계층입니다. 실제 강한 sandbox enforcement는 이후 단계에서 worker, iframe, import whitelist와 함께 확장해야 합니다.

## 권장 구조

앱에서는 직접 여러 곳에서 manifest를 검증하기보다, host bootstrap 단계에서 한 번 host contract를 만들고 이를 공유하는 방식이 좋습니다.

```typescript
export const hostCompatibility = {
  abiVersion: '1.0.0',
  dependencies: [],
  stores: [],
  accelerators: []
};
```

이렇게 해두면 패키지가 늘어나도 같은 기준으로 실행 여부를 판단할 수 있습니다.
