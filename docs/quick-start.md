# 빠른 시작

이 문서는 저장소를 설치하고, 빌드하고, 데모를 실행한 뒤 핵심 API를 확인하는 순서로 구성되어 있습니다.

## 1. 설치

Node.js 18 이상이 필요합니다.

```bash
corepack enable
corepack prepare pnpm@8.10.0 --activate
pnpm install
```

Rust와 `wasm-pack`은 Rust/WASM 코어를 빌드하는 데 필요합니다. 현재 store 실행 경로는 `packages/core-rust`에서 빌드된 WASM 산출물만 사용합니다.

## 2. 빌드

패키지 전체 빌드:

```bash
pnpm -r --filter "./packages/**" run build
```

container builder 빌드:

```bash
pnpm --filter @gaesup-state/container-builder run build
```

core 테스트:

```bash
pnpm --filter @gaesup-state/core exec vitest run src/__tests__/core.test.ts
```

## 3. 데모 실행

```bash
pnpm --filter @gaesup-state/multi-framework-demo run dev -- --host 0.0.0.0
```

접속 주소:

```text
http://localhost:3000/
```

## 4. 데모에서 확인할 것

### 공유 카운터 페이지

React, Vue, Svelte, Angular-like 네 카드가 같은 store를 구독합니다.

확인 순서:

1. React 카드에서 `+1`을 누릅니다.
2. 네 카드의 count가 모두 같은 값으로 바뀌는지 봅니다.
3. Vue, Svelte, Angular-like 카드에서도 같은 방식으로 확인합니다.
4. 상단 `Shared count` 값과 각 카드 값이 같은지 확인합니다.

### 의존성 격리 페이지

이 페이지는 컨테이너 manifest 검증 결과를 보여줍니다.

- `공유 실행`: host 의존성과 store schema가 모두 맞음
- `패키징 실행`: 컨테이너가 자기 의존성을 함께 패키징함
- `격리 실행`: 실행은 가능하지만 공유 store schema가 맞지 않아 격리 store 사용
- `차단`: host 의존성이나 store 계약이 맞지 않아 실행 불가

## 5. Store 만들기

```typescript
import { GaesupCore } from '@gaesup-state/core';

await GaesupCore.createStore('orders', { items: [] }, {
  schema: {
    storeId: 'orders',
    schemaId: 'orders-state',
    schemaVersion: '1.2.0'
  }
});
```

상태 읽기:

```typescript
const fullState = GaesupCore.select('orders', '');
const items = GaesupCore.select('orders', 'items');
```

상태 쓰기:

```typescript
await GaesupCore.dispatch('orders', 'MERGE', {
  items: [{ id: 1, title: '첫 주문' }]
});
```

구독:

```typescript
const callbackId = 'orders-listener';

GaesupCore.registerCallback(callbackId, () => {
  console.log(GaesupCore.select('orders', ''));
});

const subscriptionId = GaesupCore.subscribe('orders', '', callbackId);

GaesupCore.unsubscribe(subscriptionId);
GaesupCore.unregisterCallback(callbackId);
```

콜백은 반드시 `subscribe`보다 먼저 등록해야 합니다.

## 6. Container manifest 검증

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

const decision = guard.validate({
  manifestVersion: '1.0',
  name: 'legacy-report',
  version: '0.8.0',
  gaesup: { abiVersion: '^1.0.0' },
  dependencies: [
    { name: 'chart.js', version: '^3.9.0', source: 'bundled' }
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

`source: 'bundled'`인 의존성은 컨테이너 내부에 패키징된 것으로 간주합니다. host가 다른 버전을 가지고 있어도 host 의존성 그래프를 바꾸지 않습니다.

## 7. 자주 나는 문제

### 타입 선언 파일이 없다고 나오는 경우

패키지 빌드를 먼저 실행합니다.

```bash
pnpm -r --filter "./packages/**" run build
```

### 데모에서 버튼을 눌러도 한 카드만 바뀌는 경우

같은 `storeId`를 바라보는지 확인합니다. 데모는 `multi-framework-demo` store 하나를 네 프레임워크가 공유합니다.

### host 의존성 충돌이 나는 경우

그 의존성이 host에서 제공되어야 하는지, 컨테이너에 번들링되어야 하는지 먼저 결정해야 합니다.

```typescript
{ name: 'chart.js', version: '^3.9.0', source: 'bundled' }
```
