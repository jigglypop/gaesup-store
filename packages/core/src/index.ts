/// <reference path="./wasm.d.ts" />

import initWasm, * as wasm from '../../core-rust/pkg-web/gaesup_state_core.js';

export type DependencyConflictPolicy = 'reject' | 'isolate' | 'migrate' | 'readonly';
export type AcceleratorKind = 'cpu' | 'webgpu' | 'cuda';

export interface Action<T = any> {
  type: string;
  payload?: T;
}

export interface PackageDependencyContract {
  name: string;
  version: string;
  optional?: boolean;
  source?: 'host' | 'bundled';
}

export interface StoreDependencyContract {
  storeId: string;
  schemaId: string;
  schemaVersion: string;
  compatRange?: string;
  required?: boolean;
  conflictPolicy?: DependencyConflictPolicy;
}

export interface AcceleratorDependencyContract {
  kind: AcceleratorKind;
  version?: string;
  optional?: boolean;
  capabilities?: string[];
}

export interface HostAcceleratorContract {
  kind: AcceleratorKind;
  version?: string;
  capabilities?: string[];
}

export interface RegisteredStoreSchema {
  storeId: string;
  schemaId: string;
  schemaVersion: string;
  compatRange?: string;
}

export interface HostCompatibilityConfig {
  hostVersion?: string;
  abiVersion?: string;
  defaultConflictPolicy?: DependencyConflictPolicy;
  dependencies?: PackageDependencyContract[] | Record<string, string>;
  stores?: RegisteredStoreSchema[];
  accelerators?: HostAcceleratorContract[];
}

export interface ContainerPackageManifest {
  manifestVersion: string;
  name: string;
  version: string;
  runtime?: string;
  gaesup?: { abiVersion: string; minHostVersion?: string };
  dependencies?: PackageDependencyContract[];
  stores?: StoreDependencyContract[];
  accelerators?: AcceleratorDependencyContract[];
  allowedImports?: string[];
  permissions?: Record<string, any>;
}

export interface ValidationIssue {
  code: string;
  message: string;
  severity: 'error' | 'warning';
  target?: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  isolatedStores: string[];
}

export interface ContainerConfig {
  id?: string;
  name: string;
  runtime?: string;
  initialState?: any;
}

export type ContainerEventType = 'container:created' | 'container:started' | 'container:stopped' | 'container:error';
export type ContainerEvent = Record<string, any> & { type: ContainerEventType };
export type ContainerManagerConfig = Record<string, any>;
export type ContainerMetrics = Record<string, any>;
export type ContainerMetadata = Record<string, any>;

let ready: Promise<void> | null = null;
const dispatchListeners = new Map<string, Set<(action: Action, state: any) => void>>();

function ensureReady() {
  ready ||= Promise.resolve(initWasm()).then(() => {
    wasm.init?.();
  });
  return ready;
}

function requireReady() {
  if (!ready) {
    throw new Error('Rust WASM core is not initialized yet');
  }
}

export const GaesupCore = {
  async initStore(initialState: any = {}) {
    return this.createStore('main', initialState);
  },
  async createStore(storeId: string, initialState: any = {}, options: { schema?: RegisteredStoreSchema } = {}) {
    await ensureReady();
    await wasm.create_store(storeId, initialState);
    if (options.schema) await wasm.register_store_schema(options.schema);
  },
  async cleanupStore(storeId: string) {
    await ensureReady();
    wasm.cleanup_store(storeId);
    dispatchListeners.delete(storeId);
  },
  async garbageCollect() {
    await ensureReady();
    wasm.garbage_collect();
    wasm.cleanup_containers();
    dispatchListeners.clear();
  },
  async dispatch(storeIdOrActionType: string, actionTypeOrPayload?: any, payload?: any) {
    await ensureReady();
    const legacy = payload === undefined && typeof actionTypeOrPayload !== 'string';
    const storeId = legacy ? 'main' : storeIdOrActionType;
    const actionType = legacy ? storeIdOrActionType : actionTypeOrPayload;
    const actionPayload = legacy ? actionTypeOrPayload : payload;
    const state = await wasm.dispatch(storeId, actionType, actionPayload);
    dispatchListeners.get(storeId)?.forEach((listener) => listener({ type: actionType, payload: actionPayload }, state));
    return state;
  },
  async dispatchCounter(storeId: string, delta: number, framework: string, actionName: string) {
    await ensureReady();
    const state = await (wasm as any).dispatch_counter(storeId, delta, framework, actionName);
    dispatchListeners.get(storeId)?.forEach((listener) => listener({ type: actionName, payload: { delta, framework } }, state));
    return state;
  },
  async dispatchCounterBatch(storeId: string, delta: number, count: number, framework: string, actionName: string) {
    await ensureReady();
    const state = await (wasm as any).dispatch_counter_batch(storeId, delta, count, framework, actionName);
    dispatchListeners.get(storeId)?.forEach((listener) => listener({ type: `${actionName}_BATCH`, payload: { delta, count, framework } }, state));
    return state;
  },
  select(storeIdOrPath = 'main', maybePath?: string) {
    requireReady();
    const storeId = maybePath === undefined ? 'main' : storeIdOrPath;
    const path = maybePath === undefined ? storeIdOrPath : maybePath;
    return wasm.select(storeId, path || '');
  },
  subscribe(storeId: string, path: string, callbackOrId: string | ((state: any) => void)) {
    requireReady();
    const callback = typeof callbackOrId === 'function' ? callbackOrId : callbackRegistry.get(callbackOrId);
    if (!callback) throw new Error(`Callback not registered: ${callbackOrId}`);
    return wasm.subscribe(storeId, path || '', callback);
  },
  unsubscribe(subscriptionId: string) {
    wasm.unsubscribe(subscriptionId);
  },
  registerCallback(callbackId: string, callback: (state?: any) => void) {
    callbackRegistry.set(callbackId, callback);
  },
  unregisterCallback(callbackId: string) {
    callbackRegistry.delete(callbackId);
  },
  async createSnapshot(storeId = 'main') {
    await ensureReady();
    return wasm.create_snapshot(storeId);
  },
  async restoreSnapshot(storeIdOrSnapshotId: string, maybeSnapshotId?: string) {
    await ensureReady();
    const storeId = maybeSnapshotId === undefined ? 'main' : storeIdOrSnapshotId;
    const snapshotId = maybeSnapshotId === undefined ? storeIdOrSnapshotId : maybeSnapshotId;
    return wasm.restore_snapshot(storeId, snapshotId);
  },
  async getMetrics(storeId = 'main') {
    await ensureReady();
    return wasm.get_metrics(storeId);
  },
  registerStoreSchema(schema: RegisteredStoreSchema) {
    requireReady();
    return wasm.register_store_schema(schema);
  },
  getStoreSchemas() {
    requireReady();
    return wasm.get_store_schemas();
  },
  createBatchUpdate(storeId: string) {
    const batch = new wasm.BatchUpdate(storeId);
    return {
      addUpdate: (actionType: string, payload: any) => batch.add_update(actionType, payload),
      add: (actionType: string, payload: any) => batch.add_update(actionType, payload),
      execute: () => batch.execute()
    };
  },
  onDispatch(storeId: string, listener: (action: Action, state: any) => void) {
    const listeners = dispatchListeners.get(storeId) || new Set();
    listeners.add(listener);
    dispatchListeners.set(storeId, listeners);
    return () => listeners.delete(listener);
  },
  registerReducer() {
    throw new Error('Reducers must be compiled into the Rust WASM core path');
  }
};

const callbackRegistry = new Map<string, (state?: any) => void>();

export class CompatibilityGuard {
  constructor(private readonly host: HostCompatibilityConfig = {}) {}
  validate(manifest: ContainerPackageManifest): ValidationResult {
    requireReady();
    return wasm.validate_manifest(manifest, this.host);
  }
  static validate(manifest: ContainerPackageManifest, host: HostCompatibilityConfig = {}) {
    requireReady();
    return wasm.validate_manifest(manifest, host) as ValidationResult;
  }
}

export class ContainerInstance {
  constructor(private readonly id: string) {}
  getId() { return this.id; }
  getStatus() { return this.getMetrics().status; }
  async call(functionName: string, args?: any) { await ensureReady(); return wasm.call_container(this.id, functionName, args); }
  getState() { requireReady(); return wasm.get_container_state(this.id); }
  getMetrics() { requireReady(); return wasm.get_container_metrics(this.id); }
  async stop() { await ensureReady(); return wasm.stop_container(this.id); }
}

export class ContainerManager {
  private listeners = new Map<ContainerEventType, Set<(event: ContainerEvent) => void>>();
  constructor(readonly config: ContainerManagerConfig = {}) {}
  async createContainer(config: ContainerConfig) {
    await ensureReady();
    const created = wasm.create_container(config);
    const instance = new ContainerInstance(created.id);
    this.emit('container:created', { type: 'container:created', id: created.id, containerId: created.id });
    return instance;
  }
  async run(name: string) {
    const container = await this.createContainer({ name });
    return container.getId();
  }
  getContainer(id: string) { return new ContainerInstance(id); }
  listContainers() { requireReady(); return wasm.list_containers() as ContainerMetadata[]; }
  async cleanup() { await ensureReady(); wasm.cleanup_containers(); }
  on(type: ContainerEventType, listener: (event: ContainerEvent) => void) {
    const listeners = this.listeners.get(type) || new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
    return () => listeners.delete(listener);
  }
  private emit(type: ContainerEventType, event: ContainerEvent) {
    this.listeners.get(type)?.forEach((listener) => listener(event));
  }
}

export class WASMContainerManager extends ContainerManager {}

export async function createOptimalContainerManager(config: ContainerManagerConfig = {}) {
  await ensureReady();
  return new WASMContainerManager(config);
}

export class ReduxDevToolsBridge {
  containerCreated() {}
  functionCalled() {}
  errorOccurred() {}
}

export function getDevToolsBridge() {
  return new ReduxDevToolsBridge();
}

export type StateListener<T = any> = (state: T) => void;
export { ensureReady as initGaesupCore };
