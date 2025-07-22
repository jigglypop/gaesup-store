# 🚀 Gaesup-State Quick Start Guide

## 목차
1. [설치](#설치)
2. [기본 사용법](#기본-사용법)
3. [프레임워크별 가이드](#프레임워크별-가이드)
4. [고급 기능](#고급-기능)
5. [성능 최적화](#성능-최적화)
6. [문제 해결](#문제-해결)

## 설치

### 자동 설정 (권장)
```bash
# 프로젝트 클론
git clone https://github.com/gaesup/gaesup-state.git
cd gaesup-state

# 자동 설정 스크립트 실행
chmod +x scripts/setup.sh
./scripts/setup.sh

# 개발 서버 시작
pnpm dev
```

### 수동 설정

#### 1. 필수 도구 설치
```bash
# Node.js 18+ 필요
node --version

# pnpm 설치
npm install -g pnpm

# Rust 설치
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# wasm-pack 설치
curl https://rustwasm.github.io/wasm-pack/installer/init.sh -sSf | sh
```

#### 2. 프로젝트 의존성 설치
```bash
pnpm install
```

#### 3. WASM 빌드
```bash
pnpm run build:wasm
```

## 기본 사용법

### 1. 스토어 생성
```typescript
import { GaesupCore } from '@gaesup-state/core';

// 스토어 생성
await GaesupCore.createStore('myStore', {
  user: { name: 'John', age: 30 },
  todos: [],
  settings: { theme: 'light' }
});
```

### 2. 상태 읽기
```typescript
// 전체 상태
const state = GaesupCore.select('myStore', '');

// 특정 필드
const userName = GaesupCore.select('myStore', 'user.name');
const theme = GaesupCore.select('myStore', 'settings.theme');
```

### 3. 상태 업데이트
```typescript
// SET: 전체 교체
await GaesupCore.dispatch('myStore', 'SET', {
  user: { name: 'Jane', age: 25 },
  todos: [],
  settings: { theme: 'dark' }
});

// MERGE: 부분 업데이트
await GaesupCore.dispatch('myStore', 'MERGE', {
  user: { name: 'Jane' } // age는 유지됨
});

// UPDATE: 중첩된 값 업데이트
await GaesupCore.dispatch('myStore', 'UPDATE', {
  path: 'user.age',
  value: 31
});

// DELETE: 필드 삭제
await GaesupCore.dispatch('myStore', 'DELETE', 'user.age');
```

### 4. 구독
```typescript
// 콜백 등록
GaesupCore.registerCallback('myCallback', () => {
  console.log('State changed!');
});

// 구독
const subscriptionId = GaesupCore.subscribe('myStore', '', 'myCallback');

// 구독 해제
GaesupCore.unsubscribe(subscriptionId);
```

## 프레임워크별 가이드

### React

```tsx
import { useGaesupState } from '@gaesup-state/react';

function Counter() {
  const [state, dispatch] = useGaesupState('counter', {
    count: 0
  });

  return (
    <div>
      <p>Count: {state.count}</p>
      <button onClick={() => dispatch({ type: 'SET', payload: { count: state.count + 1 } })}>
        Increment
      </button>
    </div>
  );
}

// Redux 스타일
import { createGaesupStore } from '@gaesup-state/react';

const store = createGaesupStore('app', {
  user: null,
  todos: []
});

// Redux Toolkit 스타일
import { createSlice } from '@gaesup-state/core/immer';

const todosSlice = createSlice({
  name: 'todos',
  initialState: [],
  reducers: {
    addTodo: (state, action) => {
      state.push(action.payload);
    },
    removeTodo: (state, action) => {
      return state.filter(todo => todo.id !== action.payload);
    }
  }
});
```

### Vue 3

```vue
<template>
  <div>
    <p>Count: {{ state.count }}</p>
    <button @click="increment">Increment</button>
  </div>
</template>

<script setup>
import { useGaesupState } from '@gaesup-state/vue';

const { state, dispatch } = useGaesupState('counter', {
  count: 0
});

const increment = () => {
  dispatch('SET', { count: state.value.count + 1 });
};
</script>
```

```typescript
// Pinia 스타일
import { defineStore } from '@gaesup-state/vue';

export const useCounterStore = defineStore({
  id: 'counter',
  state: () => ({
    count: 0,
    doubleCount: 0
  }),
  getters: {
    double: (state) => state.count * 2
  },
  actions: {
    increment() {
      this.count++;
    }
  }
});
```

### Svelte

```svelte
<script>
import { gaesupStore } from '@gaesup-state/svelte';

// Svelte store 스타일
const count = gaesupStore('count', 0);

function increment() {
  count.update(n => n + 1);
}
</script>

<button on:click={increment}>
  Count: {$count}
</button>
```

```typescript
// 커스텀 스토어
import { defineGaesupStore } from '@gaesup-state/svelte';

export const todos = defineGaesupStore('todos', {
  initialState: { items: [], filter: 'all' },
  actions: {
    addTodo(state, text) {
      state.items.push({ id: Date.now(), text, done: false });
    },
    toggleTodo(state, id) {
      const todo = state.items.find(t => t.id === id);
      if (todo) todo.done = !todo.done;
    }
  },
  getters: {
    visibleTodos(state) {
      switch (state.filter) {
        case 'active': return state.items.filter(t => !t.done);
        case 'completed': return state.items.filter(t => t.done);
        default: return state.items;
      }
    }
  }
});
```

## 고급 기능

### 1. Immer 스타일 업데이트

```typescript
import { produce, produceWithStore } from '@gaesup-state/core/immer';

// 직접 사용
const nextState = produce(currentState, draft => {
  draft.user.name = 'New Name';
  draft.todos.push({ id: 1, text: 'New Todo' });
});

// 스토어와 함께 사용
await produceWithStore('myStore', draft => {
  draft.user.age++;
  draft.settings.notifications = true;
});
```

### 2. 미들웨어

```typescript
import { logger, thunk, devTools } from '@gaesup-state/core/middleware';
import { middlewareManager } from '@gaesup-state/core/middleware';

// 미들웨어 적용
middlewareManager.applyMiddleware('myStore', logger, thunk, devTools);

// 커스텀 미들웨어
const myMiddleware = store => next => action => {
  console.log('Action:', action);
  const result = next(action);
  console.log('New State:', store.getState());
  return result;
};
```

### 3. 배치 업데이트

```typescript
const batch = GaesupCore.createBatchUpdate('myStore');

batch.addUpdate('MERGE', { user: { name: 'Alice' } });
batch.addUpdate('UPDATE', { path: 'settings.theme', value: 'dark' });
batch.addUpdate('MERGE', { todos: [{ id: 1, text: 'Todo 1' }] });

await batch.execute();
```

### 4. 스냅샷 & 시간 여행

```typescript
// 스냅샷 생성
const snapshotId = await GaesupCore.createSnapshot('myStore');

// 상태 변경
await GaesupCore.dispatch('myStore', 'SET', { count: 100 });

// 스냅샷 복원
await GaesupCore.restoreSnapshot('myStore', snapshotId);
```

### 5. 영속성

```typescript
// LocalStorage에 저장
await GaesupCore.persist_store('myStore', 'my-app-state');

// 복원
await GaesupCore.hydrate_store('myStore', 'my-app-state');
```

## 성능 최적화

### 1. 선택적 구독
```typescript
// 특정 경로만 구독
const subId = GaesupCore.subscribe('myStore', 'user.profile', 'callback');
```

### 2. 메모이제이션
```typescript
import { useMemo } from 'react';
import { useGaesupState } from '@gaesup-state/react';

function ExpensiveComponent() {
  const [state] = useGaesupState('myStore');
  
  const expensiveValue = useMemo(() => {
    return computeExpensiveValue(state.data);
  }, [state.data]);
  
  return <div>{expensiveValue}</div>;
}
```

### 3. 배치 업데이트 활용
```typescript
// 나쁜 예: 여러 번 디스패치
await GaesupCore.dispatch('myStore', 'MERGE', { a: 1 });
await GaesupCore.dispatch('myStore', 'MERGE', { b: 2 });
await GaesupCore.dispatch('myStore', 'MERGE', { c: 3 });

// 좋은 예: 배치 업데이트
const batch = GaesupCore.createBatchUpdate('myStore');
batch.addUpdate('MERGE', { a: 1, b: 2, c: 3 });
await batch.execute();
```

### 4. 메트릭스 모니터링
```typescript
const metrics = await GaesupCore.getMetrics('myStore');
console.log('Average dispatch time:', metrics.avg_dispatch_time);
console.log('Memory usage:', metrics.memory_usage);
```

## 문제 해결

### WASM 로딩 실패
```typescript
// 수동 초기화
import init from '@gaesup-state/core-rust';

await init(); // WASM 모듈 로드
```

### TypeScript 타입 에러
```typescript
// 타입 정의
interface MyState {
  user: { name: string; age: number };
  todos: Array<{ id: number; text: string }>;
}

const [state] = useGaesupState<MyState>('myStore');
```

### 메모리 누수
```typescript
// 컴포넌트 언마운트 시 정리
useEffect(() => {
  const unsubscribe = subscribeToStore(callback);
  
  return () => {
    unsubscribe();
  };
}, []);
```

## 다음 단계

- [API 레퍼런스](./api-reference.md) - 전체 API 문서
- [성능 가이드](./performance.md) - 성능 최적화 팁
- [마이그레이션 가이드](./11_migration_strategy.md) - 기존 프로젝트 마이그레이션
- [예제 프로젝트](../examples) - 실제 사용 예제

## 도움이 필요하신가요?

- GitHub Issues: https://github.com/gaesup/gaesup-state/issues
- Discord: https://discord.gg/gaesup-state
- 이메일: support@gaesup-state.com 