# Resource와 query

`resource`와 `query`는 API 요청 상태를 Gaesup store와 같은 모델로 다루기 위한 API입니다.

React Query, Zustand, Jotai를 같이 쓰다 보면 다음처럼 상태가 나뉘기 쉽습니다.

- API 요청 상태는 React Query
- UI 상태는 Zustand 또는 Jotai
- WASM 패키지 상태는 Gaesup store
- optimistic update는 컴포넌트 내부 임시 상태

`resource`는 이 중 API 상태를 Gaesup auto store 안으로 넣습니다. 그래서 `data`, `status`, `isFetching`, `error`, `mutate`, `invalidate`, `refetch`를 하나의 객체에서 다룹니다.

## 가장 작은 예제

```typescript
import { resource } from 'gaesup-state';

const todos = resource('todos', async () => {
  const response = await fetch('/api/todos');
  if (!response.ok) throw new Error('Failed to load todos');
  return response.json() as Promise<Array<{ id: number; title: string }>>;
});

await todos.$ready;
await todos.refetch();

console.log(todos.status);
console.log(todos.data);
```

`query`는 `resource`의 alias입니다.

```typescript
import { query } from 'gaesup-state';

const profile = query('profile', fetchProfile);
```

## 상태 필드

resource 객체는 다음 필드를 갖습니다.

| 필드 | 의미 |
| --- | --- |
| `data` | 성공한 요청의 데이터입니다. 아직 없으면 `undefined`입니다. |
| `error` | 마지막 실패 error입니다. |
| `status` | `idle`, `loading`, `success`, `error` 중 하나입니다. |
| `isLoading` | 첫 데이터를 기다리는 중이면 `true`입니다. |
| `isFetching` | refetch가 진행 중이면 `true`입니다. 기존 data가 있어도 `true`일 수 있습니다. |
| `isStale` | 데이터가 오래되었거나 invalidate된 상태입니다. |
| `updatedAt` | 마지막 성공 또는 mutate 시각입니다. |

## enabled

기본값은 `enabled: true`입니다. 생성 후 microtask에서 자동 fetch를 시작합니다.

검색창, 탭 진입, 사용자 액션 이후에만 요청하고 싶으면 `enabled: false`를 씁니다.

```typescript
const search = resource(
  ['search', 'users'],
  ({ q }: { q: string }) => fetchUsers(q),
  { enabled: false }
);

await search.refetch({ q: 'ada' });
```

## staleTime

`staleTime` 동안 fresh 데이터로 간주하면 불필요한 refetch를 막을 수 있습니다.

```typescript
const profile = resource('profile', fetchProfile, {
  initialData: cachedProfile,
  staleTime: 60_000
});

await profile.refetch(); // 60초 안이면 fetcher를 다시 부르지 않습니다.
```

현재 구현은 단순한 stale 방어입니다. React Query처럼 background refetch, retry, cache garbage collection을 모두 제공하는 단계는 아닙니다.

## mutate

`mutate`는 local data를 먼저 바꾸고 store에 반영합니다.

```typescript
await todos.mutate((previous = []) => [
  ...previous,
  { id: Date.now(), title: 'local first' }
]);
```

낙관적 업데이트 예시는 다음처럼 구성할 수 있습니다.

```typescript
const previous = todos.data;

await todos.mutate((items = []) => [
  ...items,
  { id: tempId, title: draftTitle }
]);

try {
  await createTodo(draftTitle);
  await todos.invalidate();
  await todos.refetch();
} catch (error) {
  await todos.mutate(previous ?? []);
  throw error;
}
```

## invalidate

`invalidate`는 데이터를 stale로 표시합니다.

```typescript
await todos.invalidate();
```

이후 `refetch`를 호출하면 staleTime 조건과 관계없이 다시 fetch할 수 있습니다.

## refetch

`refetch`는 fetcher를 실행하고 결과를 resource state에 반영합니다.

```typescript
await todos.refetch();
```

변수가 필요한 fetcher는 제네릭과 함께 사용할 수 있습니다.

```typescript
const users = resource<Array<User>, { q: string }>(
  ['users'],
  ({ q }) => fetchUsers(q),
  { enabled: false }
);

await users.refetch({ q: 'grace' });
```

## React에서 쓰기

resource 자체는 React에 묶여 있지 않습니다. 컴포넌트에서는 기존 adapter 또는 store 구독을 통해 화면에 연결하면 됩니다.

가장 단순한 패턴은 resource를 모듈 바깥에 만들고, 화면에서는 `watch` 또는 framework adapter로 필요한 필드를 읽는 것입니다.

```typescript
export const todos = resource('todos', fetchTodos);
```

```typescript
watch(
  todos,
  (state) => [state.status, state.data] as const,
  ([status, data]) => {
    console.log(status, data);
  }
);
```

React Query처럼 컴포넌트마다 hook을 만들기보다는, Gaesup에서는 resource도 store의 일부로 보고 여러 프레임워크가 같은 상태를 볼 수 있게 하는 쪽이 기본 방향입니다.

## React Query와 다른 점

| 항목 | React Query | Gaesup resource |
| --- | --- | --- |
| 주 목적 | React 앱의 서버 상태 관리 | WASM/store/container 상태와 API 상태 통합 |
| framework 의존성 | React 중심 | framework 독립 |
| cache 전략 | 강력하고 세밀함 | 현재는 단순 staleTime 중심 |
| optimistic update | mutation API 중심 | `mutate`로 store 직접 갱신 |
| 공유 범위 | React tree 중심 | store id 기준, 여러 framework에서 공유 가능 |
| 패키지 격리와 연결 | 별도 설계 필요 | manifest/store schema 모델과 같은 방향 |

이미 React Query의 retry, pagination, infinite query, devtools가 필요하면 React Query가 더 성숙합니다. Gaesup resource는 “API 상태까지 같은 store 계약 안으로 넣고 싶다”는 경우에 맞습니다.

## 에러 처리

fetcher가 throw하면 resource는 다음 상태가 됩니다.

```typescript
status = 'error';
isLoading = false;
isFetching = false;
error = thrownError;
```

예시:

```typescript
try {
  await profile.refetch();
} catch (error) {
  console.error(profile.error);
}
```

## 컨테이너와 같이 쓰는 방향

WASM 패키지가 API 데이터를 요구한다면 다음 순서가 안전합니다.

1. host가 manifest를 검증합니다.
2. store schema가 맞으면 공유 resource/store를 제공합니다.
3. schema가 맞지 않으면 resource도 isolated namespace로 분리합니다.
4. 패키지는 host dependency graph를 직접 바꾸지 않고 data contract만 사용합니다.

이 모델이 완성되면 API 요청 결과, UI 상태, WASM package state가 모두 같은 계약 체계 안에서 움직일 수 있습니다.
