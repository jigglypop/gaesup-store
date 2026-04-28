/// <reference path="./wasm-types.d.ts" />

import type { Action, RegisteredStoreSchema } from './types';
import { ContainerManager } from './container/ContainerManager';

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
        const wasmModule = isNodeRuntime()
          ? await import(/* @vite-ignore */ '@gaesup-state/core-rust/pkg-node/gaesup_state_core.js')
          : await import('@gaesup-state/core-rust/pkg-web/gaesup_state_core.js');
        const initWasm = (wasmModule as any).default;
        if (typeof initWasm === 'function') {
          await initWasm();
        }
        wasm = wasmModule;
        if (wasm.init) {
          wasm.init();
        }
        wasmInitialized = true;
        console.log('✅ Gaesup-State WASM Core initialized');
      } catch (error) {
        throw new Error(`Failed to load Rust WASM core: ${getErrorMessage(error)}`);
      }
    })();
  }

  await initPromise;
}

// DevTools 연동 (최적화)
export const GaesupCore = {
  async initStore(initialState: any = {}): Promise<void> {
    return this.createStore('main', initialState);
  },

  async createStore(storeId: string, initialState: any = {}, options: { schema?: RegisteredStoreSchema } = {}): Promise<void> {
    await ensureWasmInitialized();
    await wasm.create_store(storeId, initialState);
    if (options.schema) {
      await wasm.register_store_schema?.(options.schema);
    }
  },

  async cleanupStore(storeId: string): Promise<void> {
    await ensureWasmInitialized();
    wasm.cleanup_store(storeId);
    dispatchListeners.delete(storeId);
  },

  async garbageCollect(): Promise<void> {
    callbacks.clear();
    dispatchListeners.clear();
    await ensureWasmInitialized();
    wasm.garbage_collect();
  },

  async dispatch(storeIdOrActionType: string, actionTypeOrPayload?: any, payload?: any): Promise<any> {
    await ensureWasmInitialized();
    const isLegacyCall = payload === undefined && typeof actionTypeOrPayload !== 'string';
    const storeId = isLegacyCall ? 'main' : storeIdOrActionType;
    const actionType = isLegacyCall ? storeIdOrActionType : actionTypeOrPayload;
    const actionPayload = isLegacyCall ? actionTypeOrPayload : payload;

    try {
      const nextState = await wasm.dispatch(storeId, actionType, actionPayload);
      dispatchListeners.get(storeId)?.forEach((listener) => listener({ type: actionType, payload: actionPayload }, nextState));
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
    const selected = wasm.select(storeId, path || '');
    if (selected === undefined && path) {
      throw new Error(`State path not found: ${path}`);
    }
    return selected;
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
    const callback = callbackId ? callbacks.get(callbackId) : undefined;
    if (!callback) {
      throw new Error(`Callback not registered: ${callbackId}`);
    }
    return wasm.subscribe(storeIdOrCallback, path || '', callback);
  },

  unsubscribe(subscriptionId: string): void {
    if (wasmInitialized) {
      wasm.unsubscribe(subscriptionId);
    }
  },

  registerCallback(callbackId: string, callback: (state?: any) => void): void {
    callbacks.set(callbackId, callback);
  },

  unregisterCallback(callbackId: string): void {
    callbacks.delete(callbackId);
  },

  async createSnapshot(storeId: string = 'main'): Promise<string> {
    await ensureWasmInitialized();
    return wasm.create_snapshot(storeId);
  },

  async restoreSnapshot(storeIdOrSnapshotId: string, maybeSnapshotId?: string): Promise<any> {
    await ensureWasmInitialized();
    const storeId = maybeSnapshotId === undefined ? 'main' : storeIdOrSnapshotId;
    const snapshotId = maybeSnapshotId === undefined ? storeIdOrSnapshotId : maybeSnapshotId;
    const state = await wasm.restore_snapshot(storeId, snapshotId);
    dispatchListeners.get(storeId)?.forEach((listener) => listener({ type: 'RESTORE_SNAPSHOT', payload: snapshotId }, state));
    return state;
  },

  getMetrics(storeId: string = 'main'): any {
    if (!wasmInitialized) {
      return {
        subscriber_count: 0,
        snapshot_count: 0,
        timestamp: new Date().toISOString(),
      };
    }
    return wasm.get_metrics(storeId);
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
    throw new Error(`registerReducer is not supported by the Rust WASM core yet: ${storeId}`);
  },

  onDispatch(storeId: string, listener: (action: Action, state: any) => void): () => void {
    const listeners = dispatchListeners.get(storeId) || new Set<(action: Action, state: any) => void>();
    listeners.add(listener);
    dispatchListeners.set(storeId, listeners);
    return () => listeners.delete(listener);
  },

  registerStoreSchema(schema: RegisteredStoreSchema): void {
    if (!wasmInitialized) {
      throw new Error('Store not initialized');
    }
    wasm.register_store_schema(schema);
  },

  getStoreSchemas(): RegisteredStoreSchema[] {
    if (!wasmInitialized) {
      return [];
    }
    return wasm.get_store_schemas();
  },

  persist_store(storeId: string, storageKey: string): void {
    if (typeof localStorage === 'undefined') {
      throw new Error('localStorage is not available');
    }
    localStorage.setItem(storageKey, JSON.stringify(this.select(storeId, '')));
  },

  hydrate_store(storeId: string, storageKey: string): void {
    if (typeof localStorage === 'undefined') {
      throw new Error('localStorage is not available');
    }
    const raw = localStorage.getItem(storageKey);
    if (!raw) {
      throw new Error(`No persisted state found: ${storageKey}`);
    }
    wasm.dispatch(storeId, 'SET', JSON.parse(raw));
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
  GaesupCore.dispatch = async function(storeIdOrActionType: string, actionTypeOrPayload?: any, payload?: any) {
    const result = await originalDispatch.call(this, storeIdOrActionType, actionTypeOrPayload, payload);
    const isLegacyCall = payload === undefined && typeof actionTypeOrPayload !== 'string';
    const storeId = isLegacyCall ? 'main' : storeIdOrActionType;
    const actionType = isLegacyCall ? storeIdOrActionType : actionTypeOrPayload;
    const actionPayload = isLegacyCall ? actionTypeOrPayload : payload;
    
    devTools.send({
      type: actionType,
      payload: actionPayload,
      storeId
    }, GaesupCore.select(storeId, ''));
    
    return result;
  };
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isNodeRuntime(): boolean {
  return typeof process !== 'undefined' && Boolean(process.versions?.node) && typeof window === 'undefined';
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
  AcceleratorDependencyContract,
  AcceleratorKind,
  HostAcceleratorContract,
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
