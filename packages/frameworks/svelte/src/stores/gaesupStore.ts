import { writable, derived, get, type Readable, type Writable } from 'svelte/store';
import { GaesupCore } from '@gaesup-state/core';

// ===== Svelte 개발자가 사용하는 메인 스토어 (Svelte store와 동일) =====

export interface GaesupStoreOptions {
  persist?: boolean;
  debugMode?: boolean;
}

// Svelte의 writable과 유사한 인터페이스
export function gaesupStore<T = any>(
  storeId: string,
  initialValue: T,
  options: GaesupStoreOptions = {}
): Writable<T> & {
  // 추가 메서드
  dispatch: (action: { type: string; payload?: any }) => void;
  snapshot: () => Promise<string>;
  restore: (snapshotId: string) => Promise<void>;
} {
  // WASM 스토어 초기화
  let initialized = false;
  
  const init = async () => {
    if (!initialized) {
      try {
        await GaesupCore.createStore(storeId, initialValue);
        initialized = true;
      } catch (error) {
        // 이미 존재하는 경우 무시
        if (!error.message.includes('already exists')) {
          throw error;
        }
        initialized = true;
      }
    }
  };

  // Svelte writable 스토어 생성
  const { subscribe, set: svelteSet, update: svelteUpdate } = writable<T>(initialValue);

  // WASM 동기화를 위한 구독 설정
  let subscriptionId: string | null = null;
  let isUpdating = false;

  const setupSync = async () => {
    await init();
    
    const callbackId = `svelte_${storeId}_${Math.random().toString(36).slice(2)}`;
    
    // WASM 상태 변경 감지
    GaesupCore.registerCallback(callbackId, () => {
      if (!isUpdating) {
        const wasmState = GaesupCore.select(storeId, '');
        svelteSet(wasmState);
      }
    });
    
    subscriptionId = GaesupCore.subscribe(storeId, '', callbackId);
  };

  // 초기 동기화 설정
  setupSync();

  // set 메서드 오버라이드
  const set = (value: T) => {
    isUpdating = true;
    svelteSet(value);
    GaesupCore.dispatch(storeId, 'SET', value).finally(() => {
      isUpdating = false;
    });
  };

  // update 메서드 오버라이드
  const update = (updater: (value: T) => T) => {
    isUpdating = true;
    svelteUpdate((currentValue) => {
      const newValue = updater(currentValue);
      GaesupCore.dispatch(storeId, 'SET', newValue).finally(() => {
        isUpdating = false;
      });
      return newValue;
    });
  };

  // dispatch 메서드 (Redux 스타일 액션)
  const dispatch = (action: { type: string; payload?: any }) => {
    GaesupCore.dispatch(storeId, action.type, action.payload);
  };

  // 스냅샷 생성
  const snapshot = async (): Promise<string> => {
    return await GaesupCore.createSnapshot(storeId);
  };

  // 스냅샷 복원
  const restore = async (snapshotId: string): Promise<void> => {
    await GaesupCore.restoreSnapshot(storeId, snapshotId);
  };

  // cleanup 함수
  const cleanup = () => {
    if (subscriptionId) {
      GaesupCore.unsubscribe(subscriptionId);
    }
  };

  // 로컬 스토리지 지속성
  if (options.persist && typeof localStorage !== 'undefined') {
    const storageKey = `gaesup_${storeId}`;
    
    // 초기값 로드
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored) {
        const parsed = JSON.parse(stored);
        set(parsed);
      }
    } catch {}
    
    // 변경사항 저장
    subscribe((value) => {
      try {
        localStorage.setItem(storageKey, JSON.stringify(value));
      } catch {}
    });
  }

  return {
    subscribe,
    set,
    update,
    dispatch,
    snapshot,
    restore,
  };
}

// ===== derived 스토어 (Svelte의 derived와 동일) =====
export function gaesupDerived<T, S>(
  storeId: string,
  stores: Readable<any> | Readable<any>[],
  fn: (values: any) => S,
  initialValue?: S
): Readable<S> {
  return derived(stores, fn, initialValue);
}

// ===== 커스텀 스토어 팩토리 =====
export interface StoreDefinition<T> {
  initialState: T;
  actions?: Record<string, (state: T, payload?: any) => T | void>;
  getters?: Record<string, (state: T) => any>;
}

export function defineGaesupStore<T extends Record<string, any>>(
  storeId: string,
  definition: StoreDefinition<T>
) {
  const store = gaesupStore(storeId, definition.initialState);

  // 액션 메서드 추가
  const actions: Record<string, (payload?: any) => void> = {};
  
  if (definition.actions) {
    Object.entries(definition.actions).forEach(([name, action]) => {
      actions[name] = (payload?: any) => {
        store.update((state) => {
          const result = action(state, payload);
          return result !== undefined ? result : state;
        });
      };
    });
  }

  // Getter 추가
  const getters: Record<string, Readable<any>> = {};
  
  if (definition.getters) {
    Object.entries(definition.getters).forEach(([name, getter]) => {
      getters[name] = derived(store, getter);
    });
  }

  return {
    subscribe: store.subscribe,
    set: store.set,
    update: store.update,
    dispatch: store.dispatch,
    ...actions,
    ...getters,
  };
}

// ===== 전역 스토어 접근 =====
const stores = new Map<string, any>();

export function getStore<T = any>(storeId: string): Writable<T> {
  if (!stores.has(storeId)) {
    throw new Error(`Store '${storeId}' not found. Create it first with gaesupStore().`);
  }
  return stores.get(storeId);
}

export function createGlobalStore<T = any>(storeId: string, initialValue: T): Writable<T> {
  if (stores.has(storeId)) {
    return stores.get(storeId);
  }
  
  const store = gaesupStore(storeId, initialValue);
  stores.set(storeId, store);
  return store;
}

// ===== 유틸리티 함수 =====

// 여러 스토어를 한번에 구독
export function subscribeMany(
  storeMap: Record<string, Readable<any>>,
  callback: (values: Record<string, any>) => void
): () => void {
  const unsubscribers: Array<() => void> = [];
  const values: Record<string, any> = {};
  
  Object.entries(storeMap).forEach(([key, store]) => {
    const unsubscribe = store.subscribe((value) => {
      values[key] = value;
      callback(values);
    });
    unsubscribers.push(unsubscribe);
  });
  
  return () => {
    unsubscribers.forEach(fn => fn());
  };
}

// 스토어 리셋
export function resetStore<T>(store: Writable<T> & { dispatch?: Function }, storeId: string, initialValue: T) {
  if (store.dispatch) {
    store.dispatch({ type: 'RESET', payload: initialValue });
  } else {
    store.set(initialValue);
  }
}

// 배치 업데이트
export function batchUpdate(storeId: string, updates: Array<{ type: string; payload?: any }>) {
  const batch = GaesupCore.createBatchUpdate(storeId);
  updates.forEach(update => {
    batch.addUpdate(update.type, update.payload);
  });
  return batch.execute();
}

// ===== 성능 모니터링 =====
export function createMetricsStore(storeId: string): Readable<any> {
  const { subscribe, set } = writable(null);
  
  // 주기적으로 메트릭 업데이트
  const interval = setInterval(async () => {
    try {
      const metrics = await GaesupCore.getMetrics(storeId);
      set(metrics);
    } catch {}
  }, 1000);
  
  // cleanup
  const originalUnsubscribe = subscribe;
  const enhancedSubscribe = (run: (value: any) => void) => {
    const unsubscribe = originalUnsubscribe(run);
    return () => {
      unsubscribe();
      clearInterval(interval);
    };
  };
  
  return { subscribe: enhancedSubscribe };
}

// ===== 예제 사용법 (Svelte 개발자는 이렇게만 쓰면 됨) =====
/*
// 1. 기본 스토어
export const count = gaesupStore('count', 0);

// 컴포넌트에서 사용
<script>
  import { count } from './stores';
  
  function increment() {
    count.update(n => n + 1);
  }
</script>

<button on:click={increment}>
  Count: {$count}
</button>

// 2. 커스텀 스토어
export const todos = defineGaesupStore('todos', {
  initialState: { items: [], filter: 'all' },
  actions: {
    addTodo(state, text) {
      state.items.push({ id: Date.now(), text, done: false });
    },
    toggleTodo(state, id) {
      const todo = state.items.find(t => t.id === id);
      if (todo) todo.done = !todo.done;
    },
    setFilter(state, filter) {
      state.filter = filter;
    }
  },
  getters: {
    visibleTodos(state) {
      switch (state.filter) {
        case 'active': return state.items.filter(t => !t.done);
        case 'completed': return state.items.filter(t => t.done);
        default: return state.items;
      }
    },
    todoCount(state) {
      return state.items.filter(t => !t.done).length;
    }
  }
});

// 3. Derived 스토어
export const doubleCount = gaesupDerived(
  'doubleCount',
  count,
  $count => $count * 2
);
*/ 