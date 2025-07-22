import { ref, computed, reactive, readonly, watch, onUnmounted, Ref, ComputedRef } from 'vue';
import { GaesupCore } from '@gaesup-state/core';

// Pinia와 유사한 인터페이스
export interface StoreDefinition<T = any> {
  id: string;
  state: () => T;
  getters?: Record<string, (state: T) => any>;
  actions?: Record<string, (this: T & Record<string, any>, ...args: any[]) => any>;
}

// ===== Vue 개발자가 사용하는 메인 Composable (Pinia 스타일) =====
export function defineStore<T extends Record<string, any>>(options: StoreDefinition<T>) {
  const { id, state: stateFactory, getters = {}, actions = {} } = options;

  return () => {
    // 이미 스토어가 있는지 확인
    let initialState: T;
    try {
      initialState = GaesupCore.select(id, '') as T;
    } catch {
      // 없으면 새로 생성
      initialState = stateFactory();
      GaesupCore.createStore(id, initialState);
    }

    // 반응형 상태
    const state = reactive<T>(initialState);
    
    // 구독 ID
    const subscriptionId = ref<string | null>(null);

    // WASM 상태와 동기화
    const syncFromWasm = () => {
      const wasmState = GaesupCore.select(id, '') as T;
      Object.assign(state, wasmState);
    };

    // 구독 설정
    const callbackId = `vue_${id}_${Math.random().toString(36).slice(2)}`;
    subscriptionId.value = GaesupCore.subscribe(id, '', callbackId);
    
    // 콜백 등록
    GaesupCore.registerCallback(callbackId, syncFromWasm);

    // 언마운트 시 정리
    onUnmounted(() => {
      if (subscriptionId.value) {
        GaesupCore.unsubscribe(subscriptionId.value);
        GaesupCore.unregisterCallback(callbackId);
      }
    });

    // Getters를 computed로 변환
    const computedGetters: Record<string, ComputedRef<any>> = {};
    for (const [key, getter] of Object.entries(getters)) {
      computedGetters[key] = computed(() => getter(state));
    }

    // Actions 래핑
    const wrappedActions: Record<string, Function> = {};
    for (const [key, action] of Object.entries(actions)) {
      wrappedActions[key] = async (...args: any[]) => {
        // 액션 실행
        const result = await action.call({ ...state, ...computedGetters, ...wrappedActions }, ...args);
        
        // 상태가 변경되었으면 WASM에 동기화
        GaesupCore.dispatch(id, 'SET', state);
        
        return result;
      };
    }

    // $patch 메서드 (Pinia 호환)
    const $patch = (partialState: Partial<T> | ((state: T) => void)) => {
      if (typeof partialState === 'function') {
        partialState(state);
      } else {
        Object.assign(state, partialState);
      }
      GaesupCore.dispatch(id, 'MERGE', partialState);
    };

    // $reset 메서드 (Pinia 호환)
    const $reset = () => {
      const initialState = stateFactory();
      Object.assign(state, initialState);
      GaesupCore.dispatch(id, 'SET', initialState);
    };

    // $subscribe 메서드 (Pinia 호환)
    const $subscribe = (callback: (mutation: any, state: T) => void) => {
      return watch(
        () => state,
        (newState) => {
          callback({ type: 'direct' }, newState);
        },
        { deep: true }
      );
    };

    return {
      ...readonly(state),
      ...computedGetters,
      ...wrappedActions,
      $patch,
      $reset,
      $subscribe,
      $state: readonly(state), // Pinia 호환
    };
  };
}

// ===== 간단한 상태 관리 (Vue 3 ref/reactive 스타일) =====
export function useGaesupState<T = any>(
  storeId: string,
  initialValue?: T
): {
  state: Ref<T>;
  setState: (value: T) => void;
  patch: (partial: Partial<T>) => void;
  subscribe: (callback: (value: T) => void) => () => void;
} {
  // 초기값 설정
  let initial: T;
  try {
    initial = GaesupCore.select(storeId, '') as T;
  } catch {
    if (initialValue !== undefined) {
      initial = initialValue;
      GaesupCore.createStore(storeId, initial);
    } else {
      throw new Error(`Store '${storeId}' not found and no initial value provided`);
    }
  }

  const state = ref<T>(initial);
  const subscriptionId = ref<string | null>(null);

  // 상태 설정
  const setState = (value: T) => {
    state.value = value;
    GaesupCore.dispatch(storeId, 'SET', value);
  };

  // 부분 업데이트
  const patch = (partial: Partial<T>) => {
    if (typeof state.value === 'object' && state.value !== null) {
      Object.assign(state.value, partial);
      GaesupCore.dispatch(storeId, 'MERGE', partial);
    }
  };

  // 구독
  const subscribe = (callback: (value: T) => void) => {
    const unwatch = watch(state, (newValue) => {
      callback(newValue);
    });

    return unwatch;
  };

  // WASM 동기화
  const callbackId = `vue_simple_${storeId}_${Math.random().toString(36).slice(2)}`;
  subscriptionId.value = GaesupCore.subscribe(storeId, '', callbackId);
  
  GaesupCore.registerCallback(callbackId, () => {
    const wasmState = GaesupCore.select(storeId, '') as T;
    state.value = wasmState;
  });

  // 정리
  onUnmounted(() => {
    if (subscriptionId.value) {
      GaesupCore.unsubscribe(subscriptionId.value);
      GaesupCore.unregisterCallback(callbackId);
    }
  });

  return {
    state: readonly(state) as Ref<T>,
    setState,
    patch,
    subscribe,
  };
}

// ===== Vuex 스타일 지원 =====
export interface VuexModule<S = any> {
  namespaced?: boolean;
  state: S | (() => S);
  getters?: Record<string, (state: S) => any>;
  mutations?: Record<string, (state: S, payload?: any) => void>;
  actions?: Record<string, (context: any, payload?: any) => any>;
}

export function createVuexCompatibleStore<S>(storeId: string, module: VuexModule<S>) {
  const stateValue = typeof module.state === 'function' ? module.state() : module.state;
  
  // Pinia 스타일로 변환
  const store = defineStore({
    id: storeId,
    state: () => stateValue,
    getters: module.getters,
    actions: module.actions ? Object.entries(module.actions).reduce((acc, [key, action]) => {
      acc[key] = async function(...args: any[]) {
        // Vuex context 에뮬레이션
        const context = {
          state: this.$state,
          getters: this,
          commit: (type: string, payload?: any) => {
            if (module.mutations && module.mutations[type]) {
              module.mutations[type](this.$state, payload);
              GaesupCore.dispatch(storeId, `mutation/${type}`, payload);
            }
          },
          dispatch: (type: string, payload?: any) => {
            if (this[type]) {
              return this[type](payload);
            }
          },
        };
        return action(context, ...args);
      };
      return acc;
    }, {} as Record<string, Function>) : {},
  });

  return store;
}

// ===== 글로벌 상태 접근 =====
export function useStore(storeId: string) {
  return {
    state: computed(() => GaesupCore.select(storeId, '')),
    dispatch: (action: string, payload?: any) => {
      GaesupCore.dispatch(storeId, action, payload);
    },
    select: <T = any>(path: string): ComputedRef<T> => {
      return computed(() => GaesupCore.select(storeId, path) as T);
    },
  };
}

// ===== 유틸리티 Composables =====

// 히스토리 관리
export function useStateHistory(storeId: string) {
  const snapshots = ref<string[]>([]);

  const createSnapshot = async () => {
    const snapshotId = await GaesupCore.createSnapshot(storeId);
    snapshots.value.push(snapshotId);
    return snapshotId;
  };

  const restoreSnapshot = async (snapshotId: string) => {
    await GaesupCore.restoreSnapshot(storeId, snapshotId);
  };

  return {
    snapshots: readonly(snapshots),
    createSnapshot,
    restoreSnapshot,
  };
}

// 로컬 스토리지 동기화
export function usePersistedState<T>(
  storeId: string,
  key: string,
  initialValue: T,
  options?: { storage?: Storage }
): ReturnType<typeof useGaesupState<T>> {
  const storage = options?.storage || localStorage;
  const storageKey = `gaesup_${storeId}_${key}`;

  // 로컬 스토리지에서 초기값 로드
  let initial = initialValue;
  try {
    const stored = storage.getItem(storageKey);
    if (stored) {
      initial = JSON.parse(stored);
    }
  } catch {}

  const result = useGaesupState(storeId, initial);

  // 상태가 변경될 때마다 로컬 스토리지에 저장
  watch(result.state, (newValue) => {
    try {
      storage.setItem(storageKey, JSON.stringify(newValue));
    } catch {}
  });

  return result;
}

// ===== 예제 사용법 (Vue 개발자는 이렇게만 쓰면 됨) =====
/*
// 1. Pinia 스타일
export const useCounterStore = defineStore({
  id: 'counter',
  state: () => ({
    count: 0,
    name: 'Counter',
  }),
  getters: {
    doubleCount: (state) => state.count * 2,
  },
  actions: {
    increment() {
      this.count++;
    },
    async incrementAsync() {
      await new Promise(resolve => setTimeout(resolve, 1000));
      this.count++;
    },
  },
});

// 컴포넌트에서 사용
export default {
  setup() {
    const counter = useCounterStore();
    
    return {
      count: computed(() => counter.count),
      doubleCount: computed(() => counter.doubleCount),
      increment: counter.increment,
    };
  },
};

// 2. 심플 ref 스타일
export default {
  setup() {
    const { state: count, setState } = useGaesupState('count', 0);
    
    const increment = () => setState(count.value + 1);
    
    return { count, increment };
  },
};

// 3. Vuex 호환 스타일
const counterModule = {
  state: () => ({
    count: 0,
  }),
  mutations: {
    INCREMENT(state) {
      state.count++;
    },
  },
  actions: {
    incrementAsync({ commit }) {
      setTimeout(() => {
        commit('INCREMENT');
      }, 1000);
    },
  },
};

export const useCounter = createVuexCompatibleStore('counter', counterModule);
*/ 