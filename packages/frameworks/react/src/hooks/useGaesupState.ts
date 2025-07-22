import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { GaesupCore } from '@gaesup-state/core';

// Redux와 동일한 인터페이스
export interface Action<T = any> {
  type: string;
  payload?: T;
}

export interface GaesupStateOptions {
  debugMode?: boolean;
  devtools?: boolean;
}

// ===== 개발자가 사용하는 메인 Hook (Redux의 useSelector + useDispatch) =====
export function useGaesupState<T = any>(
  storeId: string,
  selector?: (state: any) => T,
  options: GaesupStateOptions = {}
): [T, (action: Action) => void] {
  const [state, setState] = useState<T>(() => {
    // 초기 상태 가져오기
    if (selector) {
      const fullState = GaesupCore.select(storeId, '');
      return selector(fullState);
    }
    return GaesupCore.select(storeId, '') as T;
  });

  const selectorRef = useRef(selector);
  const subscriptionRef = useRef<string | null>(null);

  // 셀렉터 업데이트
  useEffect(() => {
    selectorRef.current = selector;
  }, [selector]);

  // 구독 설정
  useEffect(() => {
    const callbackId = `react_${storeId}_${Math.random().toString(36).slice(2)}`;

    // 상태 변경 시 React 컴포넌트 업데이트
    const handleStateChange = () => {
      const fullState = GaesupCore.select(storeId, '');
      const newState = selectorRef.current ? selectorRef.current(fullState) : fullState;
      setState(newState);
    };

    // WASM 코어에 구독 등록
    subscriptionRef.current = GaesupCore.subscribe(storeId, '', callbackId);

    // JavaScript 레벨에서 콜백 등록 (WASM과 연동)
    GaesupCore.registerCallback(callbackId, handleStateChange);

    return () => {
      // 구독 해제
      if (subscriptionRef.current) {
        GaesupCore.unsubscribe(subscriptionRef.current);
        GaesupCore.unregisterCallback(callbackId);
      }
    };
  }, [storeId]);

  // dispatch 함수 (Redux와 동일)
  const dispatch = useCallback((action: Action) => {
    GaesupCore.dispatch(storeId, action.type, action.payload);
  }, [storeId]);

  // Redux DevTools 연동
  useEffect(() => {
    if (options.devtools && typeof window !== 'undefined' && (window as any).__REDUX_DEVTOOLS_EXTENSION__) {
      const devtools = (window as any).__REDUX_DEVTOOLS_EXTENSION__.connect({
        name: `Gaesup Store: ${storeId}`,
      });

      devtools.init(state);

      const unsubscribe = GaesupCore.onDispatch(storeId, (action: Action, newState: any) => {
        devtools.send(action, newState);
      });

      return () => {
        unsubscribe();
        devtools.disconnect();
      };
    }
  }, [storeId, options.devtools]);

  return [state, dispatch];
}

// ===== Redux와 동일한 개별 Hooks =====

// useSelector와 동일
export function useSelector<T = any>(
  storeId: string,
  selector: (state: any) => T
): T {
  const [state] = useGaesupState(storeId, selector);
  return state;
}

// useDispatch와 동일
export function useDispatch(storeId: string): (action: Action) => void {
  const [, dispatch] = useGaesupState(storeId);
  return dispatch;
}

// ===== 스토어 생성 (Redux의 createStore와 유사) =====
export function createGaesupStore<T = any>(
  storeId: string,
  initialState: T,
  reducer?: (state: T, action: Action) => T
): void {
  // WASM 코어에 스토어 생성
  GaesupCore.createStore(storeId, initialState);

  // 커스텀 리듀서가 있으면 등록
  if (reducer) {
    GaesupCore.registerReducer(storeId, (state: any, action: Action) => {
      return reducer(state, action);
    });
  }
}

// ===== Redux Toolkit 스타일의 Slice =====
export interface CreateSliceOptions<T> {
  name: string;
  initialState: T;
  reducers: {
    [key: string]: (state: T, action: Action) => void | T;
  };
}

export function createSlice<T>(options: CreateSliceOptions<T>) {
  const { name, initialState, reducers } = options;

  // 스토어 생성
  createGaesupStore(name, initialState);

  // 액션 생성자들
  const actions: Record<string, (payload?: any) => Action> = {};

  Object.keys(reducers).forEach((actionType) => {
    // 액션 생성자
    actions[actionType] = (payload?: any) => ({
      type: `${name}/${actionType}`,
      payload,
    });

    // 리듀서 등록
    GaesupCore.registerReducer(name, (state: T, action: Action) => {
      if (action.type === `${name}/${actionType}`) {
        const result = reducers[actionType](state, action);
        return result !== undefined ? result : state;
      }
      return state;
    });
  });

  return {
    name,
    actions,
    reducer: (state: T = initialState, action: Action) => {
      const actionName = action.type.replace(`${name}/`, '');
      if (reducers[actionName]) {
        const result = reducers[actionName](state, action);
        return result !== undefined ? result : state;
      }
      return state;
    },
  };
}

// ===== Context API 스타일 =====
import React, { createContext, useContext, ReactNode } from 'react';

interface GaesupProviderProps {
  storeId: string;
  children: ReactNode;
  initialState?: any;
  reducer?: (state: any, action: Action) => any;
}

const GaesupContext = createContext<{
  storeId: string;
  dispatch: (action: Action) => void;
} | null>(null);

export function GaesupProvider({ storeId, children, initialState = {}, reducer }: GaesupProviderProps) {
  // 스토어가 없으면 생성
  useEffect(() => {
    try {
      GaesupCore.select(storeId, '');
    } catch {
      createGaesupStore(storeId, initialState, reducer);
    }
  }, [storeId, initialState, reducer]);

  const [, dispatch] = useGaesupState(storeId);

  return (
    <GaesupContext.Provider value={{ storeId, dispatch }}>
      {children}
    </GaesupContext.Provider>
  );
}

export function useGaesupContext() {
  const context = useContext(GaesupContext);
  if (!context) {
    throw new Error('useGaesupContext must be used within a GaesupProvider');
  }
  return context;
}

// ===== 유틸리티 Hooks =====

// 배치 업데이트
export function useBatchUpdate(storeId: string): {
  batch: (updates: Action[]) => void;
  execute: () => Promise<void>;
} {
  const batchRef = useRef<Action[]>([]);

  const batch = useCallback((updates: Action[]) => {
    batchRef.current.push(...updates);
  }, []);

  const execute = useCallback(async () => {
    const updates = batchRef.current;
    batchRef.current = [];

    // WASM 코어의 배치 업데이트 사용
    const batchUpdate = GaesupCore.createBatchUpdate(storeId);
    updates.forEach(action => {
      batchUpdate.addUpdate(action.type, action.payload);
    });
    await batchUpdate.execute();
  }, [storeId]);

  return { batch, execute };
}

// 상태 히스토리 (Time Travel Debugging)
export function useStateHistory(storeId: string) {
  const [snapshots, setSnapshots] = useState<string[]>([]);

  const createSnapshot = useCallback(async () => {
    const snapshotId = await GaesupCore.createSnapshot(storeId);
    setSnapshots(prev => [...prev, snapshotId]);
    return snapshotId;
  }, [storeId]);

  const restoreSnapshot = useCallback(async (snapshotId: string) => {
    await GaesupCore.restoreSnapshot(storeId, snapshotId);
  }, [storeId]);

  return {
    snapshots,
    createSnapshot,
    restoreSnapshot,
  };
}

// 성능 모니터링
export function usePerformanceMetrics(storeId: string) {
  const [metrics, setMetrics] = useState<any>(null);

  useEffect(() => {
    const interval = setInterval(async () => {
      const newMetrics = await GaesupCore.getMetrics(storeId);
      setMetrics(newMetrics);
    }, 1000);

    return () => clearInterval(interval);
  }, [storeId]);

  return metrics;
}

// ===== 예제 사용법 (개발자는 이렇게만 쓰면 됨) =====
/*
// 1. Redux 스타일
function Counter() {
  const count = useSelector('counter', state => state.count);
  const dispatch = useDispatch('counter');

  return (
    <button onClick={() => dispatch({ type: 'increment' })}>
      Count: {count}
    </button>
  );
}

// 2. useState 스타일
function Counter() {
  const [state, dispatch] = useGaesupState('counter');

  return (
    <button onClick={() => dispatch({ type: 'increment' })}>
      Count: {state.count}
    </button>
  );
}

// 3. Redux Toolkit 스타일
const counterSlice = createSlice({
  name: 'counter',
  initialState: { count: 0 },
  reducers: {
    increment: (state) => { state.count += 1; },
    decrement: (state) => { state.count -= 1; },
  },
});

function Counter() {
  const count = useSelector('counter', state => state.count);
  const dispatch = useDispatch('counter');

  return (
    <div>
      <button onClick={() => dispatch(counterSlice.actions.increment())}>+</button>
      <span>{count}</span>
      <button onClick={() => dispatch(counterSlice.actions.decrement())}>-</button>
    </div>
  );
}
*/ 