/// <reference path="./wasm-types.d.ts" />

import type { Action, RegisteredStoreSchema } from './types';
import { ContainerManager } from './container/ContainerManager';

// Mock store 타입 정의
interface MockStore {
  state: any;
  subscriptions: Map<string, (state: any) => void>;
  reducers?: Array<(state: any, action: Action) => any>;
  schema?: RegisteredStoreSchema;
  selectCount?: number;
  updateCount?: number;
  dispatchTimeTotal?: number;
}

// Mock stores and snapshots
const mockStores: Record<string, MockStore> = {};
const mockSnapshots: Record<string, any> = {};
const storeSnapshots = new Map<string, Map<string, any>>();

// 경로 캐시 (최적화)
const pathCache = new Map<string, string[]>();

// Helper functions for nested updates
function updateNestedValue(obj: any, path: string, value: any): any {
  // 경로 캐시 활용
  let parts = pathCache.get(path);
  if (!parts) {
    parts = path.split('.');
    pathCache.set(path, parts);
  }
  
  const result = JSON.parse(JSON.stringify(obj));
  let current = result;
  
  for (let i = 0; i < parts.length - 1; i++) {
    if (!current[parts[i]]) {
      current[parts[i]] = {};
    }
    current = current[parts[i]];
  }
  
  current[parts[parts.length - 1]] = value;
  return result;
}

function deleteNestedValue(obj: any, path: string): any {
  let parts = pathCache.get(path);
  if (!parts) {
    parts = path.split('.');
    pathCache.set(path, parts);
  }
  
  const result = JSON.parse(JSON.stringify(obj));
  let current = result;
  
  for (let i = 0; i < parts.length - 1; i++) {
    if (!current[parts[i]]) {
      return result;
    }
    current = current[parts[i]];
  }
  
  delete current[parts[parts.length - 1]];
  return result;
}

function cloneState<T>(value: T): T {
  if (typeof structuredClone === 'function') {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
}

function getStore(storeId: string): MockStore {
  const store = mockStores[storeId];
  if (!store) {
    throw new Error(`Store not found: ${storeId}`);
  }
  return store;
}

function selectFromState(state: any, path: string = ''): any {
  if (!path) return state;

  let parts = pathCache.get(path);
  if (!parts) {
    parts = path.split('.');
    pathCache.set(path, parts);
  }

  let value = state;
  for (const part of parts) {
    if (value && typeof value === 'object' && part in value) {
      value = value[part];
    } else {
      throw new Error(`State path not found: ${path}`);
    }
  }

  return value;
}

function updateExistingNestedValue(obj: any, path: string, value: any): any {
  if (!path) return value;

  const parts = pathCache.get(path) || path.split('.');
  pathCache.set(path, parts);

  let current = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!current || typeof current !== 'object' || !(parts[i] in current)) {
      throw new Error(`State path not found: ${path}`);
    }
    current = current[parts[i]];
  }

  const leaf = parts[parts.length - 1];
  if (!current || typeof current !== 'object' || !(leaf in current)) {
    throw new Error(`State path not found: ${path}`);
  }

  return updateNestedValue(obj, path, value);
}

function applyAction(store: MockStore, actionType: string, payload: any): any {
  const action: Action = { type: actionType, payload };

  if (store.reducers?.length) {
    for (const reducer of store.reducers) {
      const reduced = reducer(store.state, action);
      if (reduced !== undefined && reduced !== store.state) {
        return reduced;
      }
    }
  }

  switch (actionType) {
    case 'SET':
      return payload;
    case 'MERGE':
      if (typeof store.state === 'object' && store.state !== null && typeof payload === 'object' && payload !== null) {
        return { ...store.state, ...payload };
      }
      return payload;
    case 'UPDATE':
      if (!payload?.path) {
        throw new Error('UPDATE action requires payload.path');
      }
      return updateExistingNestedValue(store.state, payload.path, payload.value);
    case 'DELETE':
      return deleteNestedValue(store.state, payload);
    case 'BATCH': {
      let nextState = store.state;
      for (const update of payload || []) {
        nextState = applyAction({ ...store, state: nextState }, update.actionType || update.type, update.payload);
      }
      return nextState;
    }
    default:
      if (store.reducers?.length) {
        return store.state;
      }
      return store.state;
  }
}

function notifyStore(storeId: string, action: Action): void {
  const store = getStore(storeId);
  const state = store.state;

  store.subscriptions.forEach((callback) => callback(state));
  dispatchListeners.get(storeId)?.forEach((listener) => listener(action, state));
}

// 최적화된 Mock WASM 구현
const mockWasm = {
  init() {
    console.log('🚀 Gaesup-State Mock WASM Core (Optimized) initialized');
  },
  
  init_store(initialState: any): void {
    mockStores.main = {
      state: initialState,
      subscriptions: new Map()
    };
  },
  
  dispatch(actionType: string, payload: any): any {
    const store = mockStores.main;
    if (!store) throw new Error('Store not initialized');
    
    let newState = store.state;
    
    switch (actionType) {
      case 'SET':
        newState = payload;
        break;
      case 'MERGE':
        if (typeof store.state === 'object' && typeof payload === 'object') {
          newState = { ...store.state, ...payload };
        }
        break;
      case 'UPDATE':
        if (payload.path && payload.value !== undefined) {
          newState = updateNestedValue(store.state, payload.path, payload.value);
        }
        break;
      case 'BATCH':
        // 배치 업데이트 최적화
        newState = { ...store.state };
        for (const update of payload) {
          if (update.path && update.value !== undefined) {
            const parts = pathCache.get(update.path) || update.path.split('.');
            if (!pathCache.has(update.path)) {
              pathCache.set(update.path, parts);
            }
            
            let current = newState;
            for (let i = 0; i < parts.length - 1; i++) {
              if (!current[parts[i]]) current[parts[i]] = {};
              current = current[parts[i]];
            }
            current[parts[parts.length - 1]] = update.value;
          }
        }
        break;
    }
    
    store.state = newState;
    
    // 배치 알림 (setTimeout으로 최적화)
    if (store.subscriptions.size > 0) {
      setTimeout(() => {
        store.subscriptions.forEach((callback) => callback(newState));
      }, 0);
    }
    
    return newState;
  },
  
  select(path: string): any {
    const store = mockStores.main;
    if (!store) throw new Error('Store not initialized');
    
    if (!path) return store.state;
    
    // 경로 캐시 활용
    let parts = pathCache.get(path);
    if (!parts) {
      parts = path.split('.');
      pathCache.set(path, parts);
    }
    
    let value = store.state;
    for (const part of parts) {
      if (value && typeof value === 'object') {
        value = value[part];
      } else {
        return undefined;
      }
    }
    
    return value;
  },
  
  subscribe(callback: any): string {
    const store = mockStores.main;
    if (!store) throw new Error('Store not initialized');
    
    const subscriptionId = `sub_${Math.random().toString(36).substr(2, 9)}`;
    store.subscriptions.set(subscriptionId, callback);
    
    return subscriptionId;
  },
  
  unsubscribe(subscriptionId: string): void {
    const store = mockStores.main;
    if (store) {
      store.subscriptions.delete(subscriptionId);
    }
  },
  
  create_snapshot(): string {
    const store = mockStores.main;
    if (!store) throw new Error('Store not initialized');
    
    const snapshotId = `snap_${Math.random().toString(36).substr(2, 9)}`;
    mockSnapshots[snapshotId] = JSON.parse(JSON.stringify(store.state));
    
    return snapshotId;
  },
  
  restore_snapshot(snapshotId: string): any {
    const store = mockStores.main;
    if (!store) throw new Error('Store not initialized');
    
    const snapshot = mockSnapshots[snapshotId];
    if (!snapshot) throw new Error(`Snapshot ${snapshotId} not found`);
    
    store.state = JSON.parse(JSON.stringify(snapshot));
    
    // 알림
    setTimeout(() => {
      store.subscriptions.forEach((callback) => callback(store.state));
    }, 0);
    
    return store.state;
  },
  
  get_metrics(): any {
    return {
      subscriber_count: mockStores.main?.subscriptions.size || 0,
      cache_size: pathCache.size,
      snapshot_count: Object.keys(mockSnapshots).length,
      timestamp: new Date().toISOString(),
    };
  },
  
  cleanup(): void {
    // 캐시 정리
    if (pathCache.size > 1000) {
      pathCache.clear();
    }
    
    // 스냅샷 정리
    const snapIds = Object.keys(mockSnapshots);
    if (snapIds.length > 10) {
      snapIds.slice(0, snapIds.length - 10).forEach(id => {
        delete mockSnapshots[id];
      });
    }
  },
  
  // BatchUpdate 클래스
  BatchUpdate: class {
    updates: Array<{ path: string; value: any }> = [];
    
    constructor() {
      this.updates = [];
    }
    
    add(path: string, value: any): void {
      this.updates.push({ path, value });
    }
    
    execute(): any {
      if (!mockStores.main) throw new Error('Store not initialized');
      return mockWasm.dispatch('BATCH', this.updates);
    }
  }
};

// 동적 import로 WASM 모듈 로드
let wasm: any = null;
let wasmInitialized = false;
let initPromise: Promise<void> | null = null;

// 콜백 저장소
const callbacks = new Map<string, (state?: any) => void>();
const dispatchListeners = new Map<string, Set<(action: Action, state: any) => void>>();

// WASM 초기화
async function ensureWasmInitialized(): Promise<void> {
  if (wasmInitialized) return;

  if (!initPromise) {
    initPromise = (async () => {
      try {
        const wasmModule = await import(/* @vite-ignore */ '@gaesup-state/core-rust');
        wasm = wasmModule;
        if (wasm.init) {
          wasm.init();
        }
        wasmInitialized = true;
        console.log('✅ Gaesup-State WASM Core initialized');
      } catch (error) {
        console.warn('⚠️ Failed to load WASM module, using JavaScript mock implementation');
        wasm = mockWasm;
        wasm.init();
        wasmInitialized = true;
      }
    })();
  }

  await initPromise;
}

// 최적화된 GaesupCore API
export const LegacyGaesupCore = {
  // 스토어 초기화
  async initStore(initialState: any = {}): Promise<void> {
    await ensureWasmInitialized();
    try {
      wasm.init_store(initialState);
    } catch (error) {
      throw new Error(`Failed to initialize store: ${error}`);
    }
  },

  // 액션 디스패치 (최적화)
  async dispatch(actionType: string, payload?: any): Promise<any> {
    await ensureWasmInitialized();
    try {
      return wasm.dispatch(actionType, payload);
    } catch (error) {
      throw new Error(`Failed to dispatch '${actionType}': ${error}`);
    }
  },

  // 상태 선택 (최적화)
  select(path: string = ''): any {
    if (!wasmInitialized) {
      throw new Error('Store not initialized');
    }
    try {
      return wasm.select(path);
    } catch (error) {
      throw new Error(`Failed to select path '${path}': ${error}`);
    }
  },

  // 구독 (최적화)
  subscribe(callback: (state: any) => void): () => void {
    if (!wasmInitialized) {
      throw new Error('Store not initialized');
    }
    
    try {
      const subscriptionId = wasm.subscribe(callback);
      
      return () => {
        try {
          wasm.unsubscribe(subscriptionId);
        } catch (error) {
          console.error('Failed to unsubscribe:', error);
        }
      };
    } catch (error) {
      throw new Error(`Failed to subscribe: ${error}`);
    }
  },

  // 스냅샷 생성
  createSnapshot(): string {
    if (!wasmInitialized) {
      throw new Error('Store not initialized');
    }
    try {
      return wasm.create_snapshot();
    } catch (error) {
      throw new Error(`Failed to create snapshot: ${error}`);
    }
  },

  // 스냅샷 복원
  async restoreSnapshot(snapshotId: string): Promise<any> {
    await ensureWasmInitialized();
    try {
      return wasm.restore_snapshot(snapshotId);
    } catch (error) {
      throw new Error(`Failed to restore snapshot '${snapshotId}': ${error}`);
    }
  },

  // 메트릭스 조회
  getMetrics(): any {
    if (!wasmInitialized) {
      return {
        subscriber_count: 0,
        cache_size: 0,
        snapshot_count: 0,
        timestamp: new Date().toISOString(),
      };
    }
    try {
      return wasm.get_metrics();
    } catch (error) {
      console.error('Failed to get metrics:', error);
      return null;
    }
  },

  // 메모리 정리
  cleanup(): void {
    if (wasmInitialized) {
      try {
        wasm.cleanup();
      } catch (error) {
        console.error('Failed to cleanup:', error);
      }
    }
  },

  // BatchUpdate 클래스 export
  BatchUpdate: class {
    instance: any;

    constructor() {
      if (!wasmInitialized) {
        throw new Error('WASM not initialized');
      }
      this.instance = new wasm.BatchUpdate();
    }

    add(path: string, value: any): void {
      this.instance.add(path, value);
    }

    async execute(): Promise<any> {
      return this.instance.execute();
    }
  },

  // 헬퍼 메소드들
  set(newState: any): Promise<any> {
    return this.dispatch('SET', newState);
  },

  merge(partialState: any): Promise<any> {
    return this.dispatch('MERGE', partialState);
  },

  update(path: string, value: any): Promise<any> {
    return this.dispatch('UPDATE', { path, value });
  },

  batch(updates: Array<{ path: string; value: any }>): Promise<any> {
    return this.dispatch('BATCH', updates);
  }
};

// DevTools 연동 (최적화)
export const GaesupCore = {
  async initStore(initialState: any = {}): Promise<void> {
    return this.createStore('main', initialState);
  },

  async createStore(storeId: string, initialState: any = {}, options: { schema?: RegisteredStoreSchema } = {}): Promise<void> {
    await ensureWasmInitialized();
    if (mockStores[storeId]) {
      throw new Error(`Store already exists: ${storeId}`);
    }
    const store: MockStore = {
      state: cloneState(initialState),
      subscriptions: new Map(),
      reducers: [],
      selectCount: 0,
      updateCount: 0,
      dispatchTimeTotal: 0
    };

    if (options.schema) {
      store.schema = options.schema;
    }

    mockStores[storeId] = store;
  },

  async cleanupStore(storeId: string): Promise<void> {
    delete mockStores[storeId];
    storeSnapshots.delete(storeId);
    dispatchListeners.delete(storeId);
  },

  async garbageCollect(): Promise<void> {
    Object.keys(mockStores).forEach((storeId) => delete mockStores[storeId]);
    storeSnapshots.clear();
    callbacks.clear();
    dispatchListeners.clear();
    pathCache.clear();
    await ensureWasmInitialized();
    wasm.cleanup?.();
  },

  async dispatch(storeIdOrActionType: string, actionTypeOrPayload?: any, payload?: any): Promise<any> {
    await ensureWasmInitialized();
    const isLegacyCall = payload === undefined && typeof actionTypeOrPayload !== 'string';
    const storeId = isLegacyCall ? 'main' : storeIdOrActionType;
    const actionType = isLegacyCall ? storeIdOrActionType : actionTypeOrPayload;
    const actionPayload = isLegacyCall ? actionTypeOrPayload : payload;

    try {
      const startTime = performance.now();
      const store = getStore(storeId);
      const nextState = applyAction(store, actionType, actionPayload);
      const duration = performance.now() - startTime;
      store.state = nextState;
      store.updateCount = (store.updateCount || 0) + 1;
      store.dispatchTimeTotal = (store.dispatchTimeTotal || 0) + duration;
      notifyStore(storeId, { type: actionType, payload: actionPayload });
      return nextState;
    } catch (error) {
      throw new Error(`Failed to dispatch '${actionType}': ${getErrorMessage(error)}`);
    }
  },

  select(storeIdOrPath: string = 'main', maybePath?: string): any {
    if (!wasmInitialized) {
      throw new Error('Store not initialized');
    }
    const storeId = maybePath === undefined ? 'main' : storeIdOrPath;
    const path = maybePath === undefined ? storeIdOrPath : maybePath;
    const store = getStore(storeId);
    store.selectCount = (store.selectCount || 0) + 1;
    return selectFromState(store.state, path || '');
  },

  subscribe(storeIdOrCallback: string | ((state: any) => void), path?: string, callbackId?: string): string | (() => void) {
    if (!wasmInitialized) {
      throw new Error('Store not initialized');
    }
    if (typeof storeIdOrCallback === 'function') {
      const callbackKey = `legacy_${Math.random().toString(36).slice(2)}`;
      callbacks.set(callbackKey, storeIdOrCallback);
      const subscriptionId = this.subscribe('main', '', callbackKey) as string;
      return () => this.unsubscribe(subscriptionId);
    }
    const store = getStore(storeIdOrCallback);
    const callback = callbackId ? callbacks.get(callbackId) : undefined;
    if (!callback) {
      throw new Error(`Callback not registered: ${callbackId}`);
    }
    const subscriptionId = `sub_${Math.random().toString(36).slice(2)}`;
    store.subscriptions.set(subscriptionId, () => callback(selectFromState(store.state, path || '')));
    return subscriptionId;
  },

  unsubscribe(subscriptionId: string): void {
    Object.values(mockStores).forEach((store) => store.subscriptions.delete(subscriptionId));
  },

  registerCallback(callbackId: string, callback: (state?: any) => void): void {
    callbacks.set(callbackId, callback);
  },

  unregisterCallback(callbackId: string): void {
    callbacks.delete(callbackId);
  },

  async createSnapshot(storeId: string = 'main'): Promise<string> {
    const store = getStore(storeId);
    const snapshotId = `snap_${Math.random().toString(36).slice(2)}`;
    const snapshots = storeSnapshots.get(storeId) || new Map<string, any>();
    snapshots.set(snapshotId, cloneState(store.state));
    storeSnapshots.set(storeId, snapshots);
    return snapshotId;
  },

  async restoreSnapshot(storeIdOrSnapshotId: string, maybeSnapshotId?: string): Promise<any> {
    const storeId = maybeSnapshotId === undefined ? 'main' : storeIdOrSnapshotId;
    const snapshotId = maybeSnapshotId === undefined ? storeIdOrSnapshotId : maybeSnapshotId;
    const snapshot = storeSnapshots.get(storeId)?.get(snapshotId);
    if (!snapshot) {
      throw new Error(`Snapshot not found: ${snapshotId}`);
    }
    const store = getStore(storeId);
    store.state = cloneState(snapshot);
    notifyStore(storeId, { type: 'RESTORE_SNAPSHOT', payload: snapshotId });
    return store.state;
  },

  getMetrics(storeId: string = 'main'): any {
    const store = mockStores[storeId];
    if (!store) {
      return {
        subscriber_count: 0,
        cache_size: pathCache.size,
        snapshot_count: 0,
        timestamp: new Date().toISOString(),
      };
    }
    return {
      store_id: storeId,
      subscriber_count: store.subscriptions.size,
      cache_size: pathCache.size,
      snapshot_count: storeSnapshots.get(storeId)?.size || 0,
      memory_usage: JSON.stringify(store.state).length,
      total_selects: store.selectCount || 0,
      total_updates: store.updateCount || 0,
      total_dispatches: store.updateCount || 0,
      avg_dispatch_time: (store.dispatchTimeTotal || 0) / Math.max(1, store.updateCount || 0),
      schema: store.schema,
      timestamp: new Date().toISOString(),
    };
  },

  cleanup(): void {
    if (wasmInitialized) {
      try {
        wasm.cleanup();
      } catch (error) {
        console.error('Failed to cleanup:', error);
      }
    }
  },

  createBatchUpdate(storeId: string) {
    const updates: Array<{ actionType: string; payload: any }> = [];
    return {
      addUpdate(actionType: string, payload: any): void {
        updates.push({ actionType, payload });
      },
      add(actionType: string, payload: any): void {
        updates.push({ actionType, payload });
      },
      async execute(): Promise<any> {
        return GaesupCore.dispatch(storeId, 'BATCH', updates);
      }
    };
  },

  registerReducer(storeId: string, reducer: (state: any, action: Action) => any): void {
    const store = getStore(storeId);
    store.reducers = store.reducers || [];
    store.reducers.push(reducer);
  },

  onDispatch(storeId: string, listener: (action: Action, state: any) => void): () => void {
    const listeners = dispatchListeners.get(storeId) || new Set<(action: Action, state: any) => void>();
    listeners.add(listener);
    dispatchListeners.set(storeId, listeners);
    return () => listeners.delete(listener);
  },

  registerStoreSchema(schema: RegisteredStoreSchema): void {
    getStore(schema.storeId).schema = schema;
  },

  getStoreSchemas(): RegisteredStoreSchema[] {
    return Object.values(mockStores)
      .map((store) => store.schema)
      .filter((schema): schema is RegisteredStoreSchema => Boolean(schema));
  },

  persist_store(storeId: string, storageKey: string): void {
    if (typeof localStorage === 'undefined') {
      throw new Error('localStorage is not available');
    }
    localStorage.setItem(storageKey, JSON.stringify(getStore(storeId).state));
  },

  hydrate_store(storeId: string, storageKey: string): void {
    if (typeof localStorage === 'undefined') {
      throw new Error('localStorage is not available');
    }
    const raw = localStorage.getItem(storageKey);
    if (!raw) {
      throw new Error(`No persisted state found: ${storageKey}`);
    }
    const store = getStore(storeId);
    store.state = JSON.parse(raw);
    notifyStore(storeId, { type: 'HYDRATE', payload: storageKey });
  },

  set(newState: any): Promise<any> {
    return this.dispatch('main', 'SET', newState);
  },

  merge(partialState: any): Promise<any> {
    return this.dispatch('main', 'MERGE', partialState);
  },

  update(path: string, value: any): Promise<any> {
    return this.dispatch('main', 'UPDATE', { path, value });
  },

  batch(updates: Array<{ path: string; value: any }>): Promise<any> {
    return this.dispatch('main', 'BATCH', updates.map((update) => ({
      actionType: 'UPDATE',
      payload: update
    })));
  }
};

if (typeof window !== 'undefined' && (window as any).__REDUX_DEVTOOLS_EXTENSION__) {
  const devTools = (window as any).__REDUX_DEVTOOLS_EXTENSION__.connect({
    name: 'Gaesup-State',
    features: {
      pause: true,
      lock: true,
      persist: true,
      export: true,
      import: 'custom',
      jump: true,
      skip: false,
      reorder: false,
      dispatch: true,
      test: false
    }
  });
  
  // DevTools에 액션 전송
  const originalDispatch = GaesupCore.dispatch;
  GaesupCore.dispatch = async function(actionType: string, payload?: any) {
    const result = await originalDispatch.call(this, actionType, payload);
    
    devTools.send({
      type: actionType,
      payload
    }, GaesupCore.select(''));
    
    return result;
  };
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// Type exports
export type { Action, StateListener } from './types'; 
export type {
  ContainerConfig,
  ContainerEvent,
  ContainerEventType,
  ContainerManagerConfig,
  ContainerMetadata,
  ContainerMetrics,
  ContainerPackageManifest,
  DependencyConflictPolicy,
  HostCompatibilityConfig,
  RegisteredStoreSchema,
  StoreDependencyContract,
  ValidationResult
} from './types';
export { CompatibilityGuard } from './compat/CompatibilityGuard';
export { ContainerError } from './errors';
export { ContainerInstance } from './container/ContainerInstance';
export { ContainerManager } from './container/ContainerManager';
export function createStoreAwareContainerManager(
  config: ConstructorParameters<typeof ContainerManager>[0] = {}
) {
  return new ContainerManager({
    ...config,
    compatibility: {
      ...config.compatibility,
      stores: config.compatibility?.stores || GaesupCore.getStoreSchemas()
    }
  });
}
