/**
 * 프레임워크 간 상태 공유를 위한 Atom/Store 스타일 API
 * Jotai, Zustand처럼 사용하기 쉬운 인터페이스 제공
 */

import { getDevToolsBridge } from '../devtools/ReduxDevTools';

type Listener<T> = (value: T, prevValue: T) => void;
type Setter<T> = (newValue: T | ((prev: T) => T)) => void;
type Getter<T> = () => T;

export interface Atom<T> {
  readonly key: string;
  readonly defaultValue: T;
  read(get: Getter<any>): T;
  write(get: Getter<any>, set: Setter<any>, newValue: T | ((prev: T) => T)): void;
}

export interface Store<T extends Record<string, any>> {
  getState(): T;
  setState(partial: Partial<T> | ((state: T) => Partial<T>)): void;
  subscribe(listener: (state: T, prevState: T) => void): () => void;
  destroy(): void;
}

/**
 * Atom 생성 함수 (Jotai 스타일)
 */
export function atom<T>(defaultValue: T): Atom<T>;
export function atom<T>(read: (get: Getter<any>) => T): Atom<T>;
export function atom<T>(
  read: (get: Getter<any>) => T,
  write: (get: Getter<any>, set: Setter<any>, newValue: T | ((prev: T) => T)) => void
): Atom<T>;
export function atom<T>(
  defaultValueOrRead: T | ((get: Getter<any>) => T),
  write?: (get: Getter<any>, set: Setter<any>, newValue: T | ((prev: T) => T)) => void
): Atom<T> {
  const key = `atom_${Math.random().toString(36).slice(2)}`;
  
  if (typeof defaultValueOrRead === 'function') {
    // Computed atom
    return {
      key,
      defaultValue: undefined as any,
      read: defaultValueOrRead as (get: Getter<any>) => T,
      write: write || (() => { throw new Error('Cannot write to read-only atom'); })
    };
  } else {
    // Primitive atom
    return {
      key,
      defaultValue: defaultValueOrRead,
      read: () => defaultValueOrRead,
      write: (get, set, newValue) => {
        const finalValue = typeof newValue === 'function' 
          ? (newValue as (prev: T) => T)(defaultValueOrRead)
          : newValue;
        
        // DevTools에 알림
        const devTools = getDevToolsBridge();
        devTools.dispatch({
          type: '🔄 ATOM_UPDATE',
          containerId: key,
          functionName: 'setState',
          framework: 'Atom',
          timestamp: Date.now(),
          payload: { oldValue: defaultValueOrRead, newValue: finalValue }
        }, { [key]: finalValue });
        
        // 실제 값 업데이트는 외부에서 처리
      }
    };
  }
}

/**
 * Store 생성 함수 (Zustand 스타일)
 */
export function createStore<T extends Record<string, any>>(
  initialState: T | (() => T)
): Store<T> {
  const state = typeof initialState === 'function' ? initialState() : initialState;
  let currentState = { ...state };
  const listeners = new Set<(state: T, prevState: T) => void>();
  const storeId = `store_${Math.random().toString(36).slice(2)}`;

  const store: Store<T> = {
    getState: () => currentState,
    
    setState: (partial) => {
      const prevState = currentState;
      const newPartial = typeof partial === 'function' 
        ? partial(currentState)
        : partial;
      
      currentState = { ...currentState, ...newPartial };
      
      // DevTools에 알림
      const devTools = getDevToolsBridge();
      devTools.dispatch({
        type: '🏪 STORE_UPDATE',
        containerId: storeId,
        functionName: 'setState',
        framework: 'Store',
        timestamp: Date.now(),
        payload: { changes: newPartial, newState: currentState }
      }, { [storeId]: currentState });
      
      // 리스너들에게 알림
      listeners.forEach(listener => listener(currentState, prevState));
    },
    
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    
    destroy: () => {
      listeners.clear();
    }
  };

  return store;
}

/**
 * 컨테이너와 연결된 상태 생성
 */
export function createContainerState<T>(
  containerId: string,
  initialValue: T,
  framework: string = 'Unknown'
) {
  const listeners = new Set<Listener<T>>();
  let currentValue = initialValue;

  const setValue: Setter<T> = (newValue) => {
    const prevValue = currentValue;
    currentValue = typeof newValue === 'function' 
      ? (newValue as (prev: T) => T)(prevValue)
      : newValue;

    // DevTools에 알림
    const devTools = getDevToolsBridge();
    devTools.functionCalled(
      containerId,
      'setState',
      framework,
      currentValue,
      { value: currentValue }
    );

    // 리스너들에게 알림
    listeners.forEach(listener => listener(currentValue, prevValue));
  };

  const getValue: Getter<T> = () => currentValue;

  const subscribe = (listener: Listener<T>) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };

  return {
    get: getValue,
    set: setValue,
    subscribe,
    atom: atom(initialValue)
  };
}

/**
 * 전역 상태 관리자
 */
class StateManager {
  private atoms = new Map<string, any>();
  private stores = new Map<string, Store<any>>();
  private containerStates = new Map<string, any>();

  setAtomValue<T>(atom: Atom<T>, value: T) {
    this.atoms.set(atom.key, value);
    
    // DevTools 업데이트
    const devTools = getDevToolsBridge();
    devTools.dispatch({
      type: '⚛️ ATOM_SET',
      containerId: atom.key,
      functionName: 'set',
      framework: 'Global',
      timestamp: Date.now(),
      payload: value
    }, Object.fromEntries(this.atoms));
  }

  getAtomValue<T>(atom: Atom<T>): T {
    if (this.atoms.has(atom.key)) {
      return this.atoms.get(atom.key);
    }
    return atom.defaultValue;
  }

  subscribeToAtom<T>(atom: Atom<T>, listener: Listener<T>) {
    // 실제 구현에서는 더 복잡한 구독 시스템이 필요
    return () => {};
  }

  registerStore<T extends Record<string, any>>(store: Store<T>) {
    const storeId = `store_${this.stores.size}`;
    this.stores.set(storeId, store);
    return storeId;
  }

  getStore<T extends Record<string, any>>(storeId: string): Store<T> | undefined {
    return this.stores.get(storeId);
  }

  cleanup() {
    this.atoms.clear();
    this.stores.forEach(store => store.destroy());
    this.stores.clear();
    this.containerStates.clear();
  }
}

// 전역 상태 관리자 인스턴스
const globalStateManager = new StateManager();

export {
  globalStateManager as stateManager,
  type Listener,
  type Setter,
  type Getter
}; 