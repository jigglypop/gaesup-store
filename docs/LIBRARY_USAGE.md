# Gaesup-State: 라이브러리 사용자 가이드

90% 사용자는 이 세 가지만 필요합니다.

## 1️⃣ 간단한 상태: `gaesup()`

```typescript
import { gaesup } from 'gaesup-state';

// 변경 감지가 필요한 상태
const store = gaesup({
  count: 0,
  items: []
});

// 직접 수정 (자동 동기화)
store.count++;
store.items.push({ id: 1, name: 'item' });

// 구독
watch(store, s => s.count, count => {
  console.log('Count changed:', count);
});

// 스냅샷 저장 및 복원
const snapshot = store.$snapshot();
await store.$flush();  // 강제 동기화
```

**언제 쓰나:**
- React/Vue 컴포넌트의 공유 상태
- 폼 상태, UI 토글, 리스트 편집
- 여러 화면/프레임워크가 같은 상태를 봐야 할 때

**특징:**
- Proxy 기반, 직접 수정 가능
- 자동 변경 감지 및 배치
- 관계된 부분만 리렌더 (selector 기반)

---

## 2️⃣ 원자 상태: `atom()`

```typescript
import { atom } from 'gaesup-state';

const count = atom(0);
const userId = atom<string | null>(null);

// 읽기
console.log(count.get());  // 0

// 쓰기
await count.set(1);
await count.set(prev => prev + 1);

// 구독
const unsubscribe = count.watch(value => {
  console.log('Count is now:', value);
});

// 정리
unsubscribe();
await count.destroy();
```

**언제 쓰나:**
- 단순 카운터, 토글, 선택 상태
- 여러 상태가 독립적일 때
- Redux/Recoil 스타일을 선호할 때

**특징:**
- 매우 간단, 보일러플레이트 최소
- Jotai보다 가볍지만 동기화 능력 있음
- 각각 독립적인 WASM store로 관리

---

## 3️⃣ 데이터 페칭: `resource()` / `query()`

```typescript
import { resource, query } from 'gaesup-state';

// API 데이터를 상태로
const orders = resource(
  'orders',
  () => fetch('/api/orders').then(r => r.json()),
  { staleTime: 60_000 }
);

// 조건부 페칭 (variables)
const orderDetail = resource(
  ['order', id],
  (orderId: string) => fetch(`/api/orders/${orderId}`).then(r => r.json()),
  { enabled: !!id }
);

// 상태 접근
orders.data          // 페칭된 데이터
orders.isLoading     // 로딩 중?
orders.error         // 에러?
orders.status        // 'idle' | 'loading' | 'success' | 'error'

// 갱신
await orders.refetch();
orders.mutate(prev => [...prev, newOrder]);  // optimistic
await orders.invalidate();  // 다음 조회 시 새로 페칭
```

**언제 쓰나:**
- API 호출 (REST, GraphQL 등)
- 캐싱이 필요한 데이터
- React Query를 이전에 썼다면 거기에 치환

**특징:**
- React Query 같은 경험
- 하지만 `invalidateQueries` 안 함 → 서버 이벤트로 자동 갱신 (Gaesup의 장점)
- `staleTime`, `initialData` 등 표준 옵션

---

## 🔗 React에서 사용

```typescript
import { useGaesup } from '@gaesup-state/react';

function MyComponent() {
  // 자동 구독 + 리렌더
  const store = useGaesup(myStore);
  
  return (
    <div>
      <p>Count: {store.count}</p>
      <button onClick={() => store.count++}>+1</button>
    </div>
  );
}

function OrdersList() {
  const orders = useGaesup(ordersResource);
  
  if (orders.isLoading) return <p>Loading...</p>;
  if (orders.error) return <p>Error: {orders.error.message}</p>;
  
  return (
    <ul>
      {orders.data?.map(order => (
        <li key={order.id}>{order.name}</li>
      ))}
    </ul>
  );
}
```

---

## 🎯 Vue/Svelte 예제

### Vue
```typescript
import { watch } from 'gaesup-state';

export default {
  setup() {
    const store = gaesup({ count: 0 });
    
    watch(store, s => s.count, count => {
      console.log('Count changed:', count);
    });
    
    return { store };
  }
};
```

### Svelte
```typescript
import { gaesup } from 'gaesup-state';

let store = gaesup({ count: 0 });
let count;

const unwatch = watch(store, s => s.count, value => {
  count = value;
});

onDestroy(() => {
  unwatch();
  void store.$destroy();
});
```

---

## 📝 상태 머신 (State Machine)

복잡한 흐름을 명확하게:

```typescript
import { createMachine, createActor } from 'gaesup-state';

const machine = createMachine({
  id: 'order-checkout',
  initial: 'idle',
  context: { orderId: '', error: null },
  states: {
    idle: {
      on: { SUBMIT: 'loading' }
    },
    loading: {
      on: { 
        SUCCESS: 'success',
        ERROR: 'error'
      }
    },
    success: { final: true },
    error: {
      on: { RETRY: 'loading' }
    }
  }
});

const actor = createActor(machine, {
  effects: {
    submitOrder: async ({ payload }) => {
      const result = await fetch('/api/orders', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      return result.json();
    }
  }
});

await actor.start();

// 이벤트 전송
const result = await actor.send('SUBMIT');
console.log(result.snapshot.state);  // 'loading' → 'success'

// 롤백
await actor.rollback();
```

**언제 쓰나:**
- 폼 validation → 제출 → 성공/실패 흐름
- 멀티스텝 마법사
- 비동기 작업 상태 관리 (loading → done 같은 것)

**특징:**
- XState 경험이 있으면 쉬움 (V1은 flat states만)
- 가드(guard), 액션(action) 지원
- 롤백 가능

---

## ⚠️ 주의: 하지 말아야 할 것

### ❌ 매번 새로 생성
```typescript
// 나쁨
function Component() {
  const store = gaesup({ count: 0 });  // 렌더마다 새로 생성
  // ...
}

// 좋음
const store = gaesup({ count: 0 });  // 외부에서 한 번
function Component() {
  const state = useGaesup(store);
}
```

### ❌ 깊은 객체 직접 수정
```typescript
// 위험 (변경 감지 안 될 수 있음)
store.user.profile.name = 'John';

// 좋음
store.user = { ...store.user, profile: { ...store.user.profile, name: 'John' } };
// 또는
await store.$flush();  // 명시적 플러시
```

### ❌ WASM과 JS 경계를 넘나들기
```typescript
// 피해야 함
for (let i = 0; i < 1000; i++) {
  store.items[i]++;  // 1000번 WASM 호출
}

// 좋음
const pipeline = GaesupCore.createPipeline('store-id');
for (let i = 0; i < 1000; i++) {
  pipeline.update(`items.${i}`, store.items[i] + 1);
}
await pipeline.flush();  // 한 번에 배치
```

---

## 🔍 디버깅

### 타임라인 확인
```typescript
import { GaesupCore } from 'gaesup-state';

const timeline = GaesupCore.getRuntimeTimeline();
console.log(timeline);
// → 모든 상태 변경, 이벤트, 에러 기록
```

### Redux DevTools 연동
```typescript
import { getDevToolsBridge } from 'gaesup-state';

const bridge = getDevToolsBridge();
console.log(bridge.getTimeline());
```

---

## 💡 일반적인 패턴

### 폼 상태
```typescript
const form = gaesup({
  username: '',
  email: '',
  isSubmitting: false,
  errors: {}
});

async function handleSubmit() {
  form.isSubmitting = true;
  try {
    await api.register(form);
    form.isSubmitting = false;
  } catch (e) {
    form.errors = { root: e.message };
  }
}
```

### 리스트 편집
```typescript
const list = gaesup({
  items: [
    { id: 1, text: 'Todo 1', done: false },
    { id: 2, text: 'Todo 2', done: true }
  ]
});

// 추가
list.items.push({ id: 3, text: 'New', done: false });

// 수정
const todo = list.items.find(t => t.id === 1);
if (todo) todo.done = true;

// 삭제
const idx = list.items.findIndex(t => t.id === 2);
if (idx >= 0) list.items.splice(idx, 1);
```

### 필터/소트 캐시
```typescript
const data = resource('items', () => fetch('/api/items').then(r => r.json()));

const filtered = gaesup({
  items: [],
  filtered: [],
  search: '',
  sortBy: 'name'
});

watch(data, d => d.data, items => {
  if (items) filtered.items = items;
});

watch(filtered, f => ({ search: f.search, sort: f.sortBy }), () => {
  filtered.filtered = filtered.items
    .filter(i => i.name.includes(filtered.search))
    .sort((a, b) => a[filtered.sortBy].localeCompare(b[filtered.sortBy]));
});
```

---

## 📚 다음은 더 깊은 것들

- **Manifest & Sandbox**: WASM 패키지를 안전하게 로드 (multi-framework)
- **Machine Actor**: 복잡한 비동기 흐름 (취소, 재시도, 롤백)
- **Custom Store Schema**: 버전 관리, 마이그레이션
- **Performance**: typed buffers, dirty matrix 최적화 (3D/렌더링용)

이 가이드에 없는 걸 필요하면 AGENTS.md와 README.md를 참고하세요.
