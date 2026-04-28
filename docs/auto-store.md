# Auto store

Auto store는 상태관리 코드를 최대한 줄이기 위한 API입니다. 객체를 직접 수정하면 `Proxy`가 변경된 path를 기록하고, Rust/WASM store에는 변경 patch만 보냅니다.

## 가장 짧은 방식

```typescript
import { gaesup } from 'gaesup-state';

const counter = gaesup({
  count: 0,
  user: { name: 'Ada' }
});

await counter.$ready;

counter.count += 1;
counter.user.name = 'Grace';
```

store id가 필요하면 첫 번째 인자로 넘깁니다.

```typescript
const counter = gaesup('counter', { count: 0 });
```

`gaesup` 대신 `$store`를 써도 됩니다.

```typescript
import { $store } from 'gaesup-state';

const editor = $store('editor', {
  title: 'Draft',
  dirty: false
});

editor.title = 'Published';
editor.dirty = true;
```

## 하위 객체 추적

하위 객체를 변수로 빼서 수정해도 live path가 유지되면 추적됩니다.

```typescript
const user = counter.user;

user.name = 'Tracked';
```

부모 객체가 교체된 뒤 예전 하위 객체를 수정하면 stale pointer로 보고 patch를 보내지 않습니다.

```typescript
const oldUser = counter.user;

counter.user = { name: 'Grace' };
oldUser.name = 'Stale';
```

이 경우 store에는 `counter.user = { name: 'Grace' }`만 반영됩니다.

외부 raw 객체를 넣고 같은 tick 안에서 그 raw 객체를 수정하면, flush 시점의 부모 값으로 압축되어 반영됩니다.

```typescript
const external = { name: 'Grace' };

counter.user = external;
external.name = 'Raw pointer';

await counter.$flush();
```

계속 추적하고 싶다면 state에서 다시 읽은 live proxy를 사용합니다.

```typescript
const liveUser = counter.user;
liveUser.name = 'Tracked';
```

## Patch 압축

같은 flush 안에서 부모와 자식 path가 함께 바뀌면 부모 patch 하나로 압축합니다.

```typescript
counter.user = { name: 'Grace', meta: { visits: 1 } };
counter.user.meta.visits = 2;

await counter.$flush();
```

위 코드는 `user` update 하나만 보내고, 값은 최신 상태인 `{ name: 'Grace', meta: { visits: 2 } }`가 됩니다. 자잘한 하위 patch를 줄여 JS/WASM 경계 호출과 payload 수를 줄입니다.

Rust core의 `BATCH` 처리도 같은 방향으로 바뀌었습니다. 이전에는 BATCH 안의 각 update마다 state를 다시 clone하는 구조였지만, 이제는 처음에 한 번 clone한 뒤 내부 update를 in-place로 적용합니다.

## Dispatch pipeline

직접 `GaesupCore.dispatch`를 여러 번 호출하는 코드도 pipeline으로 묶을 수 있습니다.

```typescript
import { GaesupCore } from 'gaesup-state';

const pipe = GaesupCore.pipeline('editor', {
  autoFlush: false
});

pipe.update('document.title', 'New title');
pipe.update('selection.active', true);
pipe.delete('draft.error');

await pipe.flush();
```

여러 변경이 있으면 Rust/WASM으로는 `BATCH` 한 번으로 나갑니다. 같은 path를 여러 번 바꾸면 마지막 값만 남깁니다.

```typescript
pipe.update('count', 1);
pipe.update('count', 2);

await pipe.flush(); // count = 2 update 하나만 전송
```

`autoFlush`를 끄지 않으면 microtask 끝에서 자동으로 flush됩니다.

```typescript
const pipe = GaesupCore.pipeline('editor');

pipe.update('count', 1);
pipe.update('count', 2);
```

이 방식은 같은 tick 안에서 발생하는 변경을 파이프처럼 이어 붙인 뒤 한 번에 내보내기 위한 API입니다. 이벤트 핸들러, drag update, editor command, query result 반영처럼 짧은 시간에 여러 field가 같이 바뀌는 경우에 적합합니다.

## Selector watch

`watch`는 selector가 실제로 읽은 path만 의존성으로 모읍니다. 예전처럼 0ms polling으로 계속 selector를 돌리지 않습니다.

```typescript
import { gaesup, watch } from 'gaesup-state';

const cart = gaesup({
  items: [{ price: 100 }, { price: 200 }],
  user: { name: 'Ada' }
});

const off = watch(
  cart,
  (state) => state.items.reduce((sum, item) => sum + item.price, 0),
  (total) => {
    console.log(total);
  }
);

cart.user.name = 'Grace'; // total selector가 읽지 않은 path라 listener를 다시 부르지 않습니다.

off();
```

selector의 분기가 바뀌면 의존성도 다시 수집합니다.

```typescript
const view = gaesup({
  mode: 'user' as 'user' | 'guest',
  user: { name: 'Ada' },
  guest: { name: 'Visitor' }
});

watch(
  view,
  (state) => (state.mode === 'user' ? state.user.name : state.guest.name),
  console.log
);

view.mode = 'guest';
```

## API 상태까지 한 번에

`resource`와 `query`는 React Query가 필요한 자리에 쓸 수 있는 store 일체형 API입니다. 프레임워크에 묶이지 않고 `data`, `status`, `isFetching`, `error`, `invalidate`, `mutate`, `refetch`를 같은 객체에서 다룹니다.

```typescript
import { resource } from 'gaesup-state';

const todos = resource('todos', async () => {
  const response = await fetch('/api/todos');
  return response.json() as Promise<Array<{ id: number; title: string }>>;
});

await todos.$ready;
await todos.refetch();

console.log(todos.status);
console.log(todos.data);
```

초기 데이터를 넣고 `staleTime` 동안 refetch를 막을 수 있습니다.

```typescript
const profile = resource('profile', fetchProfile, {
  initialData: cachedProfile,
  staleTime: 60_000
});
```

낙관적 업데이트는 `mutate`로 처리합니다.

```typescript
await todos.mutate((previous = []) => [
  ...previous,
  { id: Date.now(), title: 'local first' }
]);

await todos.invalidate();
```

자동 fetch가 싫으면 `enabled: false`로 만들고 원하는 시점에 `refetch`합니다.

```typescript
const search = resource(
  ['search', 'users'],
  ({ q }: { q: string }) => fetchUsers(q),
  { enabled: false }
);

await search.refetch({ q: 'ada' });
```

`query`는 `resource`의 alias입니다.

```typescript
import { query } from 'gaesup-state';

const orders = query('orders', fetchOrders);
```

## Primitive atom

객체가 아니라 값 하나만 관리할 때는 `atom`을 씁니다.

```typescript
import { atom } from 'gaesup-state';

const count = atom(0);

await count.$ready;

count.value += 1;
await count.set((value) => value + 1);
```

값 변경을 구독할 수도 있습니다.

```typescript
const off = count.watch((value) => {
  console.log(value);
});

off();
```

## Transaction

여러 변경을 한 번에 묶고 싶으면 `tx`를 씁니다.

```typescript
import { tx } from 'gaesup-state';

await tx(cart, (state) => {
  state.items.push({ price: 300 });
  state.items[0].price = 120;
});
```

`tx`는 update 함수를 실행한 뒤 pending patch를 flush합니다.

## 수동 flush

기본값은 microtask 자동 flush입니다. 트랜잭션처럼 flush 타이밍을 직접 잡고 싶으면 `manual` 모드를 사용합니다.

```typescript
const editor = gaesup('editor', initialState, {
  flushMode: 'manual'
});

editor.document.title = 'New title';
editor.selection.active = true;

await editor.$flush();
```

## Snapshot과 destroy

```typescript
const localCopy = editor.$snapshot();

await editor.$destroy();
```

`$snapshot`은 현재 proxy 객체의 plain object 복사본을 반환합니다. `$destroy`는 pending patch를 flush한 뒤 Rust store를 정리합니다.

## Decorator 방식

decorator를 켠 프로젝트에서는 class를 상태처럼 사용할 수 있습니다.

```typescript
import { GaesupStore } from 'gaesup-state';

@GaesupStore('counter')
class CounterState {
  count = 0;
  user = { name: 'Ada' };

  inc() {
    this.count += 1;
  }
}

const counter = new CounterState();

await counter.$ready;

counter.inc();
counter.user.name = 'Grace';
```

`@tracked`는 marker decorator입니다. 실제 변경 추적은 class decorator가 반환하는 proxy에서 처리합니다.

```typescript
@GaesupStore('counter')
class CounterState {
  @tracked()
  count = 0;
}
```

## 선택 기준

| 목적 | 추천 |
| --- | --- |
| 코드량 최소 | `gaesup(initial)` |
| 명시적 store id | `gaesup('id', initial)` |
| 작은 값 하나 | `atom(initial)` |
| API 상태 포함 | `resource(key, fetcher)` 또는 `query(key, fetcher)` |
| selector 기반 파생값 | `watch(state, selector, listener)` |
| class 기반 모델 | `@GaesupStore('id')` |
| 트랜잭션 단위 flush | `gaesup(..., { flushMode: 'manual' })` |
| 초고빈도 숫자 update | counter handle fast path |
| 3D transform update | `GaesupRender` dirty matrix buffer |

## 주의점

Auto store는 가장 적게 쓰기 위한 경로이지, 항상 가장 빠른 경로는 아닙니다. 내부적으로는 다음 비용이 있습니다.

- `Proxy` trap 비용
- 변경값 clone 비용
- path 문자열 생성 비용
- microtask flush 비용

일반 UI 상태와 API 상태는 auto store로 편하게 쓰고, 프레임 루프나 매우 높은 빈도의 숫자 업데이트는 fast counter path 또는 render runtime으로 내려가는 구성이 좋습니다.
