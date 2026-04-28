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
  async dispatchCounterFast(storeId: string, delta: number) {
    await ensureReady();
    return (wasm as any).dispatch_counter_fast(storeId, delta) as number;
  },
  async dispatchCounterBatchFast(storeId: string, delta: number, count: number) {
    await ensureReady();
    return (wasm as any).dispatch_counter_batch_fast(storeId, delta, count) as number;
  },
  async createCounterHandle(storeId: string) {
    await ensureReady();
    return (wasm as any).create_counter_handle(storeId) as number;
  },
  releaseCounterHandle(handle: number) {
    requireReady();
    return (wasm as any).release_counter_handle(handle);
  },
  async dispatchCounterHandleFast(handle: number, delta: number) {
    await ensureReady();
    return (wasm as any).dispatch_counter_handle_fast(handle, delta) as number;
  },
  async dispatchCounterHandleBatchFast(handle: number, delta: number, count: number) {
    await ensureReady();
    return (wasm as any).dispatch_counter_handle_batch_fast(handle, delta, count) as number;
  },
  dispatchCounterHandleFastUnchecked(handle: number, delta: number) {
    requireReady();
    return (wasm as any).dispatch_counter_handle_fast_unchecked(handle, delta) as number;
  },
  dispatchCounterHandleBatchFastUnchecked(handle: number, delta: number, count: number) {
    requireReady();
    return (wasm as any).dispatch_counter_handle_batch_fast_unchecked(handle, delta, count) as number;
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

export const GaesupRender = {
  async createStore(storeId: string, initialScreen = 'main') {
    await ensureReady();
    return (wasm as any).create_render_store(storeId, initialScreen);
  },
  async createEntity(storeId: string, entity: {
    id?: string;
    instanceIndex?: number;
    transform?: {
      position?: [number, number, number];
      rotation?: [number, number, number];
      scale?: [number, number, number];
    };
    materialId?: string;
    meshId?: string;
    visible?: boolean;
  }) {
    await ensureReady();
    return (wasm as any).create_render_entity(storeId, entity) as string;
  },
  async setTransform(storeId: string, entityId: string, transform: {
    position?: [number, number, number];
    rotation?: [number, number, number];
    scale?: [number, number, number];
  }) {
    await ensureReady();
    return (wasm as any).set_render_transform(storeId, entityId, transform);
  },
  async rotateY(storeId: string, entityId: string, radians: number) {
    await ensureReady();
    return (wasm as any).rotate_render_entity_y(storeId, entityId, radians);
  },
  async beginScreenTransition(storeId: string, toScreen: string, durationMs: number, easing = 'linear') {
    await ensureReady();
    return (wasm as any).begin_screen_transition(storeId, toScreen, durationMs, easing);
  },
  async tickFrame(storeId: string, deltaMs: number) {
    await ensureReady();
    return (wasm as any).tick_render_frame(storeId, deltaMs);
  },
  async tickFrameState(storeId: string, deltaMs: number) {
    await ensureReady();
    return (wasm as any).tick_render_frame_state(storeId, deltaMs);
  },
  getPatches(storeId: string) {
    requireReady();
    return (wasm as any).get_render_patches(storeId);
  },
  getMatrixBuffer(storeId: string) {
    requireReady();
    return (wasm as any).get_render_matrix_buffer(storeId);
  },
  getDirtyMatrixBuffer(storeId: string): { count: number; instanceIndices: Uint32Array; matrices: Float32Array } {
    requireReady();
    return (wasm as any).get_render_dirty_matrix_buffer(storeId);
  },
  async benchmarkMatrixBuffer(entityCount: number) {
    await ensureReady();
    return (wasm as any).benchmark_render_matrix_buffer(entityCount);
  },
  async benchmarkDirtyMatrixBuffer(entityCount: number, dirtyCount: number) {
    await ensureReady();
    return (wasm as any).benchmark_render_dirty_matrix_buffer(entityCount, dirtyCount);
  },
  cleanup(storeId: string) {
    return (wasm as any).cleanup_render_store(storeId);
  }
};

export interface GaesupRenderObject {
  matrix?: {
    fromArray?: (values: ArrayLike<number>) => unknown;
    elements?: number[];
  };
  matrixAutoUpdate?: boolean;
  position?: { set: (x: number, y: number, z: number) => unknown };
  rotation?: { set: (x: number, y: number, z: number) => unknown };
  scale?: { set: (x: number, y: number, z: number) => unknown };
}

export interface GaesupRenderBridgeOptions {
  storeId: string;
  gpuDevice?: any;
  matrixBuffer?: any;
  matrixStrideBytes?: number;
  patchMode?: 'typed' | 'json';
}

export interface GaesupInstancedWriter {
  setMatrixAt?: (index: number, matrix: number[]) => unknown;
  writeMatrices?: (matrices: Float32Array, entities: any[]) => unknown;
  writeDirtyMatrices?: (indices: Uint32Array, matrices: Float32Array) => unknown;
  instanceMatrix?: { needsUpdate?: boolean };
}

export class GaesupRenderBridge {
  private readonly objects = new Map<string, GaesupRenderObject>();
  private readonly matrixOffsets = new Map<string, number>();
  private instancedWriter: GaesupInstancedWriter | null = null;

  constructor(private readonly options: GaesupRenderBridgeOptions) {}

  bindObject(entityId: string, object: GaesupRenderObject, matrixOffset = this.matrixOffsets.size) {
    object.matrixAutoUpdate = false;
    this.objects.set(entityId, object);
    this.matrixOffsets.set(entityId, matrixOffset);
  }

  unbindObject(entityId: string) {
    this.objects.delete(entityId);
    this.matrixOffsets.delete(entityId);
  }

  bindInstancedWriter(writer: GaesupInstancedWriter) {
    this.instancedWriter = writer;
  }

  async syncMatrixBuffer() {
    const buffer = GaesupRender.getMatrixBuffer(this.options.storeId);
    const matrices = new Float32Array(buffer.matrices);
    this.instancedWriter?.writeMatrices?.(matrices, buffer.entities);
    if (this.options.gpuDevice && this.options.matrixBuffer) {
      this.options.gpuDevice.queue.writeBuffer(this.options.matrixBuffer, 0, matrices);
    }
    return buffer;
  }

  syncDirtyMatrixBuffer() {
    const buffer = GaesupRender.getDirtyMatrixBuffer(this.options.storeId);
    this.instancedWriter?.writeDirtyMatrices?.(buffer.instanceIndices, buffer.matrices);

    if (!this.instancedWriter?.writeDirtyMatrices && this.instancedWriter?.setMatrixAt) {
      for (let i = 0; i < buffer.count; i++) {
        const matrix = Array.from(buffer.matrices.subarray(i * 16, i * 16 + 16));
        this.instancedWriter.setMatrixAt(buffer.instanceIndices[i], matrix);
      }
      if (this.instancedWriter.instanceMatrix) {
        this.instancedWriter.instanceMatrix.needsUpdate = true;
      }
    }

    if (this.options.gpuDevice && this.options.matrixBuffer) {
      const stride = this.options.matrixStrideBytes || 64;
      for (let i = 0; i < buffer.count; i++) {
        this.options.gpuDevice.queue.writeBuffer(
          this.options.matrixBuffer,
          buffer.instanceIndices[i] * stride,
          buffer.matrices.subarray(i * 16, i * 16 + 16)
        );
      }
    }

    return buffer;
  }

  async tick(deltaMs: number) {
    const frame = this.options.patchMode === 'json'
      ? await GaesupRender.tickFrame(this.options.storeId, deltaMs)
      : await GaesupRender.tickFrameState(this.options.storeId, deltaMs);
    if (this.options.patchMode === 'json') {
      this.applyPatches(frame);
      return frame;
    }
    const dirty = this.syncDirtyMatrixBuffer();
    return { frame, dirty };
  }

  applyPatches(patches: any) {
    for (const patch of patches?.dirty?.transforms || []) {
      this.applyTransformPatch(patch);
    }
  }

  private applyTransformPatch(patch: any) {
    const matrix = patch.matrix as number[] | undefined;
    if (!matrix) return;
    const instanceIndex = patch.instanceIndex as number | undefined;

    const object = this.objects.get(patch.entityId);
    if (object) {
      if (object.matrix?.fromArray) {
        object.matrix.fromArray(matrix);
      } else if (object.matrix?.elements) {
        object.matrix.elements.splice(0, 16, ...matrix);
      } else if (patch.transform) {
        const { position, rotation, scale } = patch.transform;
        object.position?.set(position[0], position[1], position[2]);
        object.rotation?.set(rotation[0], rotation[1], rotation[2]);
        object.scale?.set(scale[0], scale[1], scale[2]);
      }
    }

    if (this.instancedWriter?.setMatrixAt && instanceIndex !== undefined) {
      this.instancedWriter.setMatrixAt(instanceIndex, matrix);
      if (this.instancedWriter.instanceMatrix) {
        this.instancedWriter.instanceMatrix.needsUpdate = true;
      }
    }

    if (this.options.gpuDevice && this.options.matrixBuffer) {
      const offset = this.matrixOffsets.get(patch.entityId) ?? instanceIndex;
      if (offset !== undefined) {
        const stride = this.options.matrixStrideBytes || 64;
        this.options.gpuDevice.queue.writeBuffer(
          this.options.matrixBuffer,
          offset * stride,
          new Float32Array(matrix)
        );
      }
    }
  }
}

export type StateListener<T = any> = (state: T) => void;
export { ensureReady as initGaesupCore };
