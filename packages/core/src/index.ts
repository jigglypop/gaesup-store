/// <reference path="./wasm-types.d.ts" />

// Mock store 타입 정의
interface MockStore {
  state: any;
  subscriptions: Map<string, (state: any) => void>;
}

// Mock stores and snapshots
const mockStores: Record<string, MockStore> = {};
const mockSnapshots: Record<string, any> = {};

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
const callbacks = new Map<string, () => void>();

// WASM 초기화
async function ensureWasmInitialized(): Promise<void> {
  if (wasmInitialized) return;

  if (!initPromise) {
    initPromise = (async () => {
      try {
        const moduleName = '@gaesup-state/core-rust';
        // Avoid Vite pre-bundling resolution; allow runtime failure to fall back to JS mock
        const wasmModule = await import(/* @vite-ignore */ moduleName);
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
export const GaesupCore = {
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

// Type exports
export type { Action, StateListener } from './types';

// Container and validation types
export type { 
  ContainerConfig, 
  ValidationResult, 
  ValidationError, 
  ValidationWarning,
  ContainerMetadata,
  CompileOptions,
  ContainerManagerConfig,
  PerformanceConfig
} from './types';

// Utility functions
export { createContainer, validateContainer, compileWASM } from './utils';

// Container runtime (manager)
export { ContainerManager } from './container/ContainerManager';

// 🚀 통합 패턴 (모든 프레임워크 공통)
export {
  UnifiedGaesupManager,
  createGaesupManager,
  batchUpdate,
  getGaesupMetrics,
  enableDevTools
} from './common-pattern';

export type {
  GaesupState,
  GaesupStateActions,
  GaesupStateManager
} from './common-pattern'; 