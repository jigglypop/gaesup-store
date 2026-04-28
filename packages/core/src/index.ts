/// <reference path="./wasm.d.ts" />

import initWasm, * as wasm from 'gaesup-state-core-rust/web';

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
  name?: string;
  runtime?: string;
  initialState?: any;
  maxMemory?: number;
  maxCpuTime?: number;
  networkAccess?: boolean;
  isolation?: {
    fileSystemAccess?: boolean;
    memoryIsolation?: boolean;
    crossContainerComm?: boolean;
  };
}

export interface DispatchPipelineOptions {
  autoFlush?: boolean;
}

export interface DispatchPipeline {
  readonly storeId: string;
  readonly size: number;
  dispatch(actionType: string, payload: any): void;
  set(state: any): void;
  merge(payload: Record<string, any>): void;
  update(path: string, value: any): void;
  delete(path: string): void;
  flush(): Promise<any>;
  clear(): void;
}

export type ContainerEventType = 'container:created' | 'container:started' | 'container:stopped' | 'container:error';
export type ContainerEvent = Record<string, any> & { type: ContainerEventType };
export type ContainerManagerConfig = Record<string, any>;
export type ContainerMetrics = Record<string, any>;
export type ContainerMetadata = Record<string, any>;
export class ContainerError extends Error {
  constructor(message: string, readonly containerId?: string, readonly cause?: unknown) {
    super(message);
    this.name = 'ContainerError';
  }
}

let ready: Promise<void> | null = null;
const dispatchListeners = new Map<string, Set<(action: Action, state: any) => void>>();
const reducers = new Map<string, Set<(state: any, action: Action) => any>>();
const persistedStores = new Map<string, any>();
let autoStoreSeq = 0;
let activeAutoWatcher: AutoStoreWatcher<any, any> | null = null;

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
    const action = { type: actionType, payload: actionPayload };
    const state = reducers.has(storeId) && !isNativeAction(actionType)
      ? await dispatchThroughReducers(storeId, action)
      : await wasm.dispatch(storeId, actionType, actionPayload);
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
  createPipeline(storeId: string, options: DispatchPipelineOptions = {}) {
    return createDispatchPipeline(storeId, options);
  },
  pipeline(storeId: string, options: DispatchPipelineOptions = {}) {
    return createDispatchPipeline(storeId, options);
  },
  onDispatch(storeId: string, listener: (action: Action, state: any) => void) {
    const listeners = dispatchListeners.get(storeId) || new Set();
    listeners.add(listener);
    dispatchListeners.set(storeId, listeners);
    return () => listeners.delete(listener);
  },
  registerReducer(storeId: string, reducer: (state: any, action: Action) => any) {
    const storeReducers = reducers.get(storeId) || new Set();
    storeReducers.add(reducer);
    reducers.set(storeId, storeReducers);
    return () => {
      storeReducers.delete(reducer);
      if (storeReducers.size === 0) reducers.delete(storeId);
    };
  },
  async persistStore(storeId: string, storageKey = storeId) {
    await ensureReady();
    const state = wasm.select(storeId, '');
    writePersistedState(storageKey, state);
  },
  async hydrateStore(storeId: string, storageKey = storeId) {
    await ensureReady();
    const state = readPersistedState(storageKey);
    if (state === undefined) return undefined;
    return wasm.dispatch(storeId, 'SET', state);
  },
  async persist_store(storeId: string, storageKey = storeId) {
    return this.persistStore(storeId, storageKey);
  },
  async hydrate_store(storeId: string, storageKey = storeId) {
    return this.hydrateStore(storeId, storageKey);
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
  private listeners = new Set<(state: any) => void>();
  constructor(private readonly id: string) {}
  getId() { return this.id; }
  get metrics() { return this.getMetrics(); }
  getStatus() { return this.getMetrics().status; }
  async call<T = any>(functionName: string, args?: any) { await ensureReady(); return wasm.call_container(this.id, functionName, args) as T; }
  get state() { return this.getState(); }
  getState() { requireReady(); return wasm.get_container_state(this.id); }
  getMetrics() { requireReady(); return wasm.get_container_metrics(this.id); }
  async updateState(state: any) {
    await ensureReady();
    const next = await wasm.call_container(this.id, 'setState', state);
    this.listeners.forEach((listener) => listener(state));
    return next;
  }
  subscribe(listener: (state: any) => void) {
    this.listeners.add(listener);
    listener(this.getState());
    return () => this.listeners.delete(listener);
  }
  async stop() { await ensureReady(); return wasm.stop_container(this.id); }
}

export class ContainerManager {
  private listeners = new Map<ContainerEventType, Set<(event: ContainerEvent) => void>>();
  readonly events = {
    on: (type: string, listener: (event: ContainerEvent) => void) => this.on(type as ContainerEventType, listener)
  };
  constructor(readonly config: ContainerManagerConfig = {}) {}
  async createContainer(config: ContainerConfig) {
    await ensureReady();
    const created = wasm.create_container(config);
    const instance = new ContainerInstance(created.id);
    this.emit('container:created', { type: 'container:created', id: created.id, containerId: created.id });
    return instance;
  }
  async run(name: string, config: Partial<ContainerConfig> = {}) {
    return this.createContainer({ ...config, name });
  }
  getContainer(id: string) { return new ContainerInstance(id); }
  listContainers() { requireReady(); return wasm.list_containers() as ContainerMetadata[]; }
  getMetrics() {
    requireReady();
    return Object.fromEntries(this.listContainers().map((container) => {
      const id = container.id || container.containerId || container.name;
      return [id, wasm.get_container_metrics(id)];
    }));
  }
  async cleanup() { await ensureReady(); wasm.cleanup_containers(); }
  on(type: ContainerEventType, listener: (event: ContainerEvent) => void) {
    const listeners = this.listeners.get(type) || new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
    return () => listeners.delete(listener);
  }
  private emit(type: ContainerEventType, event: ContainerEvent) {
    this.listeners.get(type)?.forEach((listener) => listener(event));
    this.listeners.get('*' as ContainerEventType)?.forEach((listener) => listener(event));
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
    parentId?: string;
    instanceIndex?: number;
    transform?: {
      position?: [number, number, number];
      rotation?: [number, number, number];
      scale?: [number, number, number];
    };
    size?: [number, number];
    materialId?: string;
    meshId?: string;
    visible?: boolean;
    locked?: boolean;
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
  async setParent(storeId: string, entityId: string, parentId: string | null) {
    await ensureReady();
    return (wasm as any).set_render_parent(storeId, entityId, parentId);
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
  getDirtyMatrixRanges(storeId: string): GaesupMatrixRange[] {
    requireReady();
    return (wasm as any).get_render_dirty_matrix_ranges(storeId);
  },
  hitTest(storeId: string, x: number, y: number): GaesupEntityHit | null {
    requireReady();
    return (wasm as any).hit_test_render_entity(storeId, x, y);
  },
  selectAt(storeId: string, x: number, y: number, append = false): string[] {
    requireReady();
    return (wasm as any).select_render_entity_at(storeId, x, y, append);
  },
  selectRect(
    storeId: string,
    minX: number,
    minY: number,
    maxX: number,
    maxY: number,
    append = false
  ): string[] {
    requireReady();
    return (wasm as any).select_render_entities_in_rect(storeId, minX, minY, maxX, maxY, append);
  },
  getSelection(storeId: string): string[] {
    requireReady();
    return (wasm as any).get_render_selection(storeId);
  },
  applyCommand(storeId: string, command: GaesupRenderCommand): GaesupTimelineCommand {
    requireReady();
    return (wasm as any).apply_render_command(storeId, command);
  },
  undoCommand(storeId: string): GaesupTimelineCommand | null {
    requireReady();
    return (wasm as any).undo_render_command(storeId);
  },
  redoCommand(storeId: string): GaesupTimelineCommand | null {
    requireReady();
    return (wasm as any).redo_render_command(storeId);
  },
  async benchmarkMatrixBuffer(entityCount: number) {
    await ensureReady();
    return (wasm as any).benchmark_render_matrix_buffer(entityCount);
  },
  async benchmarkDirtyMatrixBuffer(entityCount: number, dirtyCount: number) {
    await ensureReady();
    return (wasm as any).benchmark_render_dirty_matrix_buffer(entityCount, dirtyCount);
  },
  async benchmarkDirtyMatrixRanges(entityCount: number, dirtyCount: number, stride = 1) {
    await ensureReady();
    return (wasm as any).benchmark_render_dirty_matrix_ranges(entityCount, dirtyCount, stride);
  },
  cleanup(storeId: string) {
    return (wasm as any).cleanup_render_store(storeId);
  }
};

export interface GaesupMatrixRange {
  startInstanceIndex: number;
  count: number;
  matrices: Float32Array;
}

export interface GaesupEntityHit {
  entityId: string;
  instanceIndex: number;
  x: number;
  y: number;
}

export type GaesupRenderCommand =
  | {
      type: 'updateTransform';
      entityId: string;
      transform: {
        position?: [number, number, number];
        rotation?: [number, number, number];
        scale?: [number, number, number];
      };
    }
  | {
      type: 'select';
      entityIds: string[];
      append?: boolean;
    }
  | {
      type: 'setParent';
      entityId: string;
      parentId?: string | null;
    }
  | {
      type: 'delete';
      entityId: string;
    };

export interface GaesupTimelineCommand {
  id: string;
  timeMs: number;
  commandType: string;
  entityId?: string;
  before: unknown;
  after: unknown;
}

export interface GaesupGpuQueue {
  writeBuffer(buffer: any, bufferOffset: number, data: ArrayBufferView | ArrayBuffer): void;
}

export interface GaesupGpuDevice {
  queue: GaesupGpuQueue;
}

export interface GaesupWgpuBufferBinding {
  buffer: any;
  strideBytes?: number;
}

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
  gpuDevice?: GaesupGpuDevice;
  matrixBuffer?: any;
  matrixStrideBytes?: number;
  patchMode?: 'typed' | 'json';
  gpuWriteMode?: 'per-instance' | 'range';
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

  syncDirtyMatrixRanges() {
    const ranges = GaesupRender.getDirtyMatrixRanges(this.options.storeId);
    if (this.options.gpuDevice && this.options.matrixBuffer) {
      writeMatrixRangesToGpu(
        this.options.gpuDevice,
        this.options.matrixBuffer,
        ranges,
        this.options.matrixStrideBytes || 64
      );
    }
    return ranges;
  }

  async tick(deltaMs: number) {
    const frame = this.options.patchMode === 'json'
      ? await GaesupRender.tickFrame(this.options.storeId, deltaMs)
      : await GaesupRender.tickFrameState(this.options.storeId, deltaMs);
    if (this.options.patchMode === 'json') {
      this.applyPatches(frame);
      return frame;
    }
    if (this.options.gpuWriteMode === 'range') {
      const ranges = this.syncDirtyMatrixRanges();
      return { frame, ranges };
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

export interface GaesupWgpuStateOptions {
  storeId: string;
  device: GaesupGpuDevice;
  matrix: GaesupWgpuBufferBinding;
}

export class GaesupWgpuState {
  constructor(private readonly options: GaesupWgpuStateOptions) {}

  writeFullMatrixBuffer() {
    const payload = GaesupRender.getMatrixBuffer(this.options.storeId);
    const matrices = new Float32Array(payload.matrices);
    this.options.device.queue.writeBuffer(this.options.matrix.buffer, 0, matrices);
    return payload;
  }

  writeDirtyMatrixRanges() {
    const ranges = GaesupRender.getDirtyMatrixRanges(this.options.storeId);
    writeMatrixRangesToGpu(
      this.options.device,
      this.options.matrix.buffer,
      ranges,
      this.options.matrix.strideBytes || 64
    );
    return ranges;
  }

  async tick(deltaMs: number) {
    const frame = await GaesupRender.tickFrameState(this.options.storeId, deltaMs);
    const ranges = this.writeDirtyMatrixRanges();
    return { frame, ranges };
  }
}

function writeMatrixRangesToGpu(
  device: GaesupGpuDevice,
  matrixBuffer: any,
  ranges: GaesupMatrixRange[],
  strideBytes: number
) {
  if (strideBytes === 64) {
    for (const range of ranges) {
      device.queue.writeBuffer(matrixBuffer, range.startInstanceIndex * strideBytes, range.matrices);
    }
    return;
  }

  for (const range of ranges) {
    for (let index = 0; index < range.count; index++) {
      const matrix = range.matrices.subarray(index * 16, index * 16 + 16);
      device.queue.writeBuffer(matrixBuffer, (range.startInstanceIndex + index) * strideBytes, matrix);
    }
  }
}

export type StateListener<T = any> = (state: T) => void;

export interface AutoStoreOptions {
  autoFlush?: boolean;
  flushMode?: 'microtask' | 'manual';
}

export interface AutoStore<T extends Record<string, any>> {
  readonly storeId: string;
  readonly state: T;
  readonly ready: Promise<void>;
  flush(): Promise<void>;
  snapshot(): T;
  destroy(): Promise<void>;
}

export type GaesupAutoState<T extends Record<string, any>> = T & {
  readonly $id: string;
  readonly $ready: Promise<void>;
  readonly $flush: () => Promise<void>;
  readonly $snapshot: () => T;
  readonly $destroy: () => Promise<void>;
};

export interface GaesupAtom<T> {
  readonly $id: string;
  readonly $ready: Promise<void>;
  value: T;
  set(next: T | ((previous: T) => T)): Promise<T>;
  get(): T;
  watch(listener: (value: T) => void): () => void;
  destroy(): Promise<void>;
}

export type ResourceStatus = 'idle' | 'loading' | 'success' | 'error';

export interface ResourceState<T> {
  data: T | undefined;
  error: any;
  status: ResourceStatus;
  isLoading: boolean;
  isFetching: boolean;
  isStale: boolean;
  updatedAt: number;
}

export interface ResourceOptions<T> {
  storeId?: string;
  enabled?: boolean;
  staleTime?: number;
  initialData?: T;
}

export type GaesupResource<T, TVariables = void> = GaesupAutoState<ResourceState<T>> & {
  refetch: TVariables extends void ? () => Promise<T> : (variables: TVariables) => Promise<T>;
  mutate(next: T | ((previous: T | undefined) => T)): Promise<T>;
  invalidate(): Promise<void>;
};

type AutoStoreMutation = {
  actionType: 'SET' | 'MERGE' | 'UPDATE' | 'DELETE' | 'BATCH';
  path: string;
  payload: any;
};

type AutoStoreWatcher<T extends Record<string, any>, R> = {
  selector: (state: T) => R;
  listener: (value: R) => void;
  previous: R;
  deps: Set<string>;
  disposed: boolean;
};

type AutoStoreRuntime<T extends Record<string, any>> = {
  state: T;
  track(path: string): void;
  notify(paths: string[]): void;
  watch<R>(selector: (state: T) => R, listener: (value: R) => void): () => void;
};

const AUTO_STORE_RUNTIMES = new WeakMap<object, AutoStoreRuntime<any>>();

const AUTO_STORE_INTERNAL_KEYS = new Set([
  'gaesupStoreId',
  'gaesupReady',
  'gaesupFlush',
  'gaesupSnapshot',
  'gaesupDestroy',
  '$id',
  '$ready',
  '$flush',
  '$snapshot',
  '$destroy'
]);

export function createAutoStore<T extends Record<string, any>>(
  storeId: string,
  initialState: T,
  options: AutoStoreOptions = {}
): AutoStore<T> {
  const target = clonePlain(initialState);
  const pending = new Map<string, AutoStoreMutation>();
  const proxyCache = new WeakMap<object, any>();
  const proxyTargets = new WeakMap<object, any>();
  const watchers = new Set<AutoStoreWatcher<T, any>>();
  const autoFlush = options.autoFlush !== false;
  const flushMode = options.flushMode || 'microtask';
  let flushScheduled = false;
  let rootProxy: T;

  const ready = GaesupCore.createStore(storeId, clonePlain(target)).catch(async (error) => {
    if (String(error?.message || error).includes('already exists')) {
      await GaesupCore.dispatch(storeId, 'SET', clonePlain(target));
      return;
    }
    throw error;
  });

  const flush = async () => {
    await ready;
    flushScheduled = false;
    const mutations = compressAutoMutations([...pending.values()], target);
    pending.clear();
    if (mutations.length === 0) return;
    if (mutations.length === 1) {
      const mutation = mutations[0];
      await GaesupCore.dispatch(storeId, mutation.actionType, mutation.payload);
      return;
    }
    await GaesupCore.dispatch(storeId, 'BATCH', mutations);
  };

  const scheduleFlush = () => {
    if (!autoFlush || flushMode === 'manual' || flushScheduled) return;
    flushScheduled = true;
    queueMicrotask(() => {
      void flush();
    });
  };

  const recordUpdate = (path: string, value: any) => {
    pending.set(path, {
      actionType: 'UPDATE',
      path,
      payload: { path, value: clonePlain(value) }
    });
    runtime.notify([path]);
    scheduleFlush();
  };

  const recordDelete = (path: string) => {
    pending.set(path, {
      actionType: 'DELETE',
      path,
      payload: { path }
    });
    runtime.notify([path]);
    scheduleFlush();
  };

  const collectDeps = <R>(watcher: AutoStoreWatcher<T, R>) => {
    watcher.deps.clear();
    const previousWatcher = activeAutoWatcher;
    activeAutoWatcher = watcher;
    try {
      return watcher.selector(rootProxy);
    } finally {
      activeAutoWatcher = previousWatcher;
    }
  };

  const rerunWatcher = <R>(watcher: AutoStoreWatcher<T, R>) => {
    if (watcher.disposed) return;
    const next = collectDeps(watcher);
    if (!Object.is(watcher.previous, next)) {
      watcher.previous = next;
      watcher.listener(next);
    }
  };

  const runtime: AutoStoreRuntime<T> = {
    get state() {
      return rootProxy;
    },
    track(path: string) {
      if (!activeAutoWatcher || !path) return;
      addAutoWatcherDependency(activeAutoWatcher, path);
    },
    notify(paths: string[]) {
      for (const watcher of [...watchers]) {
        if (watcher.disposed) continue;
        if (watcher.deps.size === 0 || paths.some((path) => [...watcher.deps].some((dep) => pathsIntersect(path, dep)))) {
          rerunWatcher(watcher);
        }
      }
    },
    watch<R>(selector: (state: T) => R, listener: (value: R) => void) {
      const watcher: AutoStoreWatcher<T, R> = {
        selector,
        listener,
        previous: undefined as R,
        deps: new Set(),
        disposed: false
      };
      watcher.previous = collectDeps(watcher);
      watchers.add(watcher);
      listener(watcher.previous);
      return () => {
        watcher.disposed = true;
        watchers.delete(watcher);
      };
    }
  };

  const proxify = (value: any, path: string): any => {
    if (!isTrackableObject(value)) return value;
    const cached = proxyCache.get(value);
    if (cached) return cached;

    const proxy = new Proxy(value, {
      get(current, key, receiver) {
        const nested = Reflect.get(current, key, receiver);
        if (typeof key === 'symbol') return nested;
        if (AUTO_STORE_INTERNAL_KEYS.has(String(key))) return nested;
        const nextPath = joinPath(path, key);
        runtime.track(nextPath);
        return proxify(nested, nextPath);
      },
      set(current, key, nextValue, receiver) {
        if (typeof key === 'symbol' || AUTO_STORE_INTERNAL_KEYS.has(String(key))) {
          return Reflect.set(current, key, nextValue, receiver);
        }
        const rawValue = proxyTargets.get(nextValue) || nextValue;
        const nextPath = joinPath(path, key);
        const ok = Reflect.set(current, key, rawValue, receiver);
        if (isLivePathTarget(target, path, current)) {
          recordUpdate(nextPath, rawValue);
        }
        return ok;
      },
      deleteProperty(current, key) {
        if (typeof key === 'symbol') return Reflect.deleteProperty(current, key);
        const nextPath = joinPath(path, key);
        const ok = Reflect.deleteProperty(current, key);
        if (isLivePathTarget(target, path, current)) {
          recordDelete(nextPath);
        }
        return ok;
      }
    });

    proxyCache.set(value, proxy);
    proxyTargets.set(proxy, value);
    return proxy;
  };

  rootProxy = proxify(target, '') as T;
  AUTO_STORE_RUNTIMES.set(rootProxy as object, runtime);

  return {
    storeId,
    state: rootProxy,
    ready,
    flush,
    snapshot: () => clonePlain(target),
    destroy: async () => {
      await ready;
      await flush();
      await GaesupCore.cleanupStore(storeId);
      watchers.clear();
    }
  };
}

export function gaesup<T extends Record<string, any>>(
  initialState: T,
  options?: AutoStoreOptions
): GaesupAutoState<T>;
export function gaesup<T extends Record<string, any>>(
  storeId: string,
  initialState: T,
  options?: AutoStoreOptions
): GaesupAutoState<T>;
export function gaesup<T extends Record<string, any>>(
  storeId: string | T,
  initialState?: T | AutoStoreOptions,
  options: AutoStoreOptions = {}
): GaesupAutoState<T> {
  const resolvedStoreId = typeof storeId === 'string' ? storeId : nextAutoStoreId('store');
  const resolvedInitialState = (typeof storeId === 'string' ? initialState : storeId) as T;
  const resolvedOptions = (typeof storeId === 'string' ? options : initialState || {}) as AutoStoreOptions;
  const auto = createAutoStore(resolvedStoreId, resolvedInitialState, resolvedOptions);
  return attachAutoControls(auto.state as GaesupAutoState<T>, {
    storeId: resolvedStoreId,
    ready: auto.ready,
    flush: auto.flush,
    snapshot: auto.snapshot,
    destroy: auto.destroy
  });
}

export const $store = gaesup;

export function atom<T>(initialValue: T, storeId = nextAutoStoreId('atom')): GaesupAtom<T> {
  let current = initialValue;
  const listeners = new Set<(value: T) => void>();
  const ready = GaesupCore.createStore(storeId, { value: clonePlain(initialValue) }).catch(async (error) => {
    if (String(error?.message || error).includes('already exists')) {
      await GaesupCore.dispatch(storeId, 'SET', { value: clonePlain(initialValue) });
      return;
    }
    throw error;
  });

  const api: GaesupAtom<T> = {
    $id: storeId,
    $ready: ready,
    get value() {
      return current;
    },
    set value(next: T) {
      current = next;
      listeners.forEach((listener) => listener(current));
      void ready.then(() => GaesupCore.dispatch(storeId, 'MERGE', { value: clonePlain(current) }));
    },
    async set(next: T | ((previous: T) => T)) {
      current = typeof next === 'function' ? (next as (previous: T) => T)(current) : next;
      listeners.forEach((listener) => listener(current));
      await ready;
      await GaesupCore.dispatch(storeId, 'MERGE', { value: clonePlain(current) });
      return current;
    },
    get() {
      return current;
    },
    watch(listener: (value: T) => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async destroy() {
      await ready;
      await GaesupCore.cleanupStore(storeId);
      listeners.clear();
    }
  };

  return api;
}

export function resource<T, TVariables = void>(
  key: string | readonly unknown[],
  fetcher: (variables: TVariables) => Promise<T>,
  options: ResourceOptions<T> = {}
): GaesupResource<T, TVariables> {
  const cacheKey = resourceKey(key);
  const storeId = options.storeId || `resource:${cacheKey}`;
  const initialData = options.initialData;
  const state = gaesup<ResourceState<T>>(storeId, {
    data: initialData,
    error: undefined,
    status: initialData === undefined ? 'idle' : 'success',
    isLoading: false,
    isFetching: false,
    isStale: initialData === undefined,
    updatedAt: initialData === undefined ? 0 : Date.now()
  });
  const staleTime = options.staleTime ?? 0;

  const refetch = async (variables?: TVariables) => {
    const now = Date.now();
    if (
      state.status === 'success' &&
      !state.isStale &&
      staleTime > 0 &&
      now - state.updatedAt < staleTime
    ) {
      return state.data as T;
    }

    state.isFetching = true;
    state.isLoading = state.data === undefined;
    if (state.status === 'idle') state.status = 'loading';
    await state.$flush();

    try {
      const data = await fetcher(variables as TVariables);
      state.data = data;
      state.error = undefined;
      state.status = 'success';
      state.isLoading = false;
      state.isFetching = false;
      state.isStale = false;
      state.updatedAt = Date.now();
      await state.$flush();
      return data;
    } catch (error) {
      state.error = error;
      state.status = 'error';
      state.isLoading = false;
      state.isFetching = false;
      await state.$flush();
      throw error;
    }
  };

  const mutate = async (next: T | ((previous: T | undefined) => T)) => {
    const data = typeof next === 'function' ? (next as (previous: T | undefined) => T)(state.data) : next;
    state.data = data;
    state.error = undefined;
    state.status = 'success';
    state.isLoading = false;
    state.isFetching = false;
    state.isStale = false;
    state.updatedAt = Date.now();
    await state.$flush();
    return data;
  };

  const invalidate = async () => {
    state.isStale = true;
    await state.$flush();
  };

  Object.defineProperties(state, {
    refetch: { value: refetch, enumerable: false },
    mutate: { value: mutate, enumerable: false },
    invalidate: { value: invalidate, enumerable: false }
  });

  if (options.enabled !== false) {
    queueMicrotask(() => {
      void (state as GaesupResource<T, TVariables>).refetch(undefined as TVariables);
    });
  }

  return state as GaesupResource<T, TVariables>;
}

export const query = resource;

export function createDispatchPipeline(storeId: string, options: DispatchPipelineOptions = {}): DispatchPipeline {
  const autoFlush = options.autoFlush !== false;
  const pending: AutoStoreMutation[] = [];
  let flushScheduled = false;
  let flushing: Promise<any> | null = null;

  const scheduleFlush = () => {
    if (!autoFlush || flushScheduled) return;
    flushScheduled = true;
    queueMicrotask(() => {
      void api.flush();
    });
  };

  const push = (actionType: 'SET' | 'MERGE' | 'UPDATE' | 'DELETE' | 'BATCH', payload: any, path = '') => {
    pending.push({ actionType: actionType as any, path, payload: clonePlain(payload) });
    scheduleFlush();
  };

  const api: DispatchPipeline = {
    storeId,
    get size() {
      return pending.length;
    },
    dispatch(actionType: string, payload: any) {
      push(actionType as any, payload, extractMutationPath(actionType, payload));
    },
    set(state: any) {
      push('SET', state);
    },
    merge(payload: Record<string, any>) {
      push('MERGE', payload);
    },
    update(path: string, value: any) {
      push('UPDATE', { path, value }, path);
    },
    delete(path: string) {
      push('DELETE', { path }, path);
    },
    async flush() {
      if (flushing) return flushing;
      flushScheduled = false;
      if (pending.length === 0) return undefined;
      const mutations = pending.splice(0, pending.length);
      flushing = flushPipelineMutations(storeId, mutations).finally(() => {
        flushing = null;
        if (pending.length > 0) scheduleFlush();
      });
      return flushing;
    },
    clear() {
      pending.length = 0;
      flushScheduled = false;
    }
  };

  return api;
}

export function watch<T extends Record<string, any>, R>(
  state: GaesupAutoState<T>,
  selector: (state: T) => R,
  listener: (value: R) => void
) {
  const runtime = AUTO_STORE_RUNTIMES.get(state as object);
  if (runtime) return runtime.watch(selector, listener);

  let previous = selector(state);
  listener(previous);
  return () => {};
}

export async function tx<T extends Record<string, any>, R>(
  state: GaesupAutoState<T>,
  update: (state: T) => R | Promise<R>
) {
  const result = await update(state);
  await state.$flush();
  return result;
}

export function GaesupStore(storeId?: string, options: AutoStoreOptions = {}) {
  return function decorateStore<T extends new (...args: any[]) => Record<string, any>>(Ctor: T): T {
    return class extends Ctor {
      gaesupStoreId!: string;
      gaesupReady!: Promise<void>;
      gaesupFlush!: () => Promise<void>;
      gaesupSnapshot!: () => Record<string, any>;
      gaesupDestroy!: () => Promise<void>;

      constructor(...args: any[]) {
        super(...args);
        const resolvedStoreId = storeId || Ctor.name;
        const initialState = extractPublicState(this);
        const auto = createAutoStore(resolvedStoreId, initialState, options);
        const proxy = auto.state as any;
        Object.setPrototypeOf(proxy, Object.getPrototypeOf(this));
        attachAutoControls(proxy, {
          storeId: resolvedStoreId,
          ready: auto.ready,
          flush: auto.flush,
          snapshot: auto.snapshot,
          destroy: auto.destroy
        });

        return proxy;
      }
    } as T;
  };
}

export function tracked() {
  return function noopTrackedDecorator(..._args: any[]) {
    // Marker decorator. The class-level proxy tracks object mutations.
  };
}

function isTrackableObject(value: any): value is Record<string, any> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !(value instanceof Date) &&
    !(value instanceof Error) &&
    !(value instanceof ArrayBuffer)
  );
}

function joinPath(base: string, key: PropertyKey) {
  const keyText = String(key);
  return base ? `${base}.${keyText}` : keyText;
}

function isLivePathTarget(root: any, path: string, expected: any) {
  if (!path) return root === expected;
  let current = root;
  for (const part of path.split('.')) {
    if (!part) continue;
    current = current?.[part];
    if (current === undefined || current === null) return false;
  }
  return current === expected;
}

function addAutoWatcherDependency(watcher: AutoStoreWatcher<any, any>, path: string) {
  for (const dep of [...watcher.deps]) {
    if (isPathAncestor(dep, path)) watcher.deps.delete(dep);
    if (isPathAncestor(path, dep) || dep === path) return;
  }
  watcher.deps.add(path);
}

function isPathAncestor(parent: string, child: string) {
  return child.startsWith(`${parent}.`);
}

function pathsIntersect(changedPath: string, watchedPath: string) {
  return changedPath === watchedPath || isPathAncestor(changedPath, watchedPath) || isPathAncestor(watchedPath, changedPath);
}

function compressAutoMutations(mutations: AutoStoreMutation[], root: any) {
  const sorted = [...mutations].sort((a, b) => pathDepth(a.path) - pathDepth(b.path));
  const compressed: AutoStoreMutation[] = [];
  for (const mutation of sorted) {
    if (compressed.some((existing) => pathsIntersect(existing.path, mutation.path) && isPathAncestor(existing.path, mutation.path))) {
      continue;
    }
    if (mutation.actionType === 'UPDATE') {
      compressed.push({
        actionType: 'UPDATE',
        path: mutation.path,
        payload: { path: mutation.path, value: clonePlain(getPathValue(root, mutation.path)) }
      });
    } else {
      compressed.push(mutation);
    }
  }
  return compressed;
}

async function flushPipelineMutations(storeId: string, mutations: AutoStoreMutation[]) {
  const normalized = compressPipelineMutations(mutations);
  if (normalized.length === 0) return undefined;
  if (normalized.length === 1) {
    const mutation = normalized[0];
    return GaesupCore.dispatch(storeId, mutation.actionType, mutation.payload);
  }
  return GaesupCore.dispatch(storeId, 'BATCH', normalized.map((mutation) => ({
    actionType: mutation.actionType,
    payload: mutation.payload
  })));
}

function compressPipelineMutations(mutations: AutoStoreMutation[]) {
  let lastSet: AutoStoreMutation | undefined;
  for (const mutation of mutations) {
    if (mutation.actionType === 'SET') lastSet = mutation;
  }

  const afterSet = lastSet ? mutations.slice(mutations.lastIndexOf(lastSet)) : mutations;
  const merged: AutoStoreMutation[] = [];
  const keyed = new Map<string, number>();

  for (const mutation of afterSet) {
    const key = mutation.path ? `${mutation.actionType}:${mutation.path}` : '';
    if (key && keyed.has(key)) {
      merged[keyed.get(key)!] = mutation;
      continue;
    }
    if (key) keyed.set(key, merged.length);
    merged.push(mutation);
  }

  return merged;
}

function extractMutationPath(actionType: string, payload: any) {
  if (actionType === 'UPDATE' || actionType === 'DELETE') {
    return typeof payload === 'string' ? payload : payload?.path || '';
  }
  return '';
}

function pathDepth(path: string) {
  return path ? path.split('.').length : 0;
}

function getPathValue(root: any, path: string) {
  if (!path) return root;
  return path.split('.').filter(Boolean).reduce((current, part) => current?.[part], root);
}

function clonePlain<T>(value: T): T {
  if (typeof structuredClone === 'function') {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
}

function isNativeAction(actionType: string) {
  return actionType === 'SET' || actionType === 'MERGE' || actionType === 'UPDATE' || actionType === 'DELETE' || actionType === 'BATCH';
}

async function dispatchThroughReducers(storeId: string, action: Action) {
  const storeReducers = reducers.get(storeId);
  if (!storeReducers || storeReducers.size === 0) {
    return wasm.dispatch(storeId, action.type, action.payload);
  }

  let nextState = clonePlain(wasm.select(storeId, ''));
  for (const reducer of storeReducers) {
    const draft = clonePlain(nextState);
    const result = reducer(draft, action);
    nextState = result === undefined ? draft : result;
  }

  return wasm.dispatch(storeId, 'SET', nextState);
}

function writePersistedState(storageKey: string, state: any) {
  const cloned = clonePlain(state);
  persistedStores.set(storageKey, cloned);
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(storageKey, JSON.stringify(cloned));
  }
}

function readPersistedState(storageKey: string) {
  if (typeof localStorage !== 'undefined') {
    const stored = localStorage.getItem(storageKey);
    if (stored !== null) return JSON.parse(stored);
  }
  return persistedStores.get(storageKey);
}

function extractPublicState(value: Record<string, any>) {
  const state: Record<string, any> = {};
  for (const key of Object.keys(value)) {
    if (!AUTO_STORE_INTERNAL_KEYS.has(key) && typeof value[key] !== 'function') {
      state[key] = clonePlain(value[key]);
    }
  }
  return state;
}

function nextAutoStoreId(prefix: string) {
  autoStoreSeq += 1;
  return `${prefix}:${autoStoreSeq}`;
}

function resourceKey(key: string | readonly unknown[]) {
  return Array.isArray(key) ? JSON.stringify(key) : key;
}

function attachAutoControls<T extends Record<string, any>>(
  target: T,
  controls: {
    storeId: string;
    ready: Promise<void>;
    flush: () => Promise<void>;
    snapshot: () => any;
    destroy: () => Promise<void>;
  }
) {
  Object.defineProperties(target, {
    gaesupStoreId: { value: controls.storeId, enumerable: false },
    gaesupReady: { value: controls.ready, enumerable: false },
    gaesupFlush: { value: controls.flush, enumerable: false },
    gaesupSnapshot: { value: controls.snapshot, enumerable: false },
    gaesupDestroy: { value: controls.destroy, enumerable: false },
    $id: { value: controls.storeId, enumerable: false },
    $ready: { value: controls.ready, enumerable: false },
    $flush: { value: controls.flush, enumerable: false },
    $snapshot: { value: controls.snapshot, enumerable: false },
    $destroy: { value: controls.destroy, enumerable: false }
  });
  return target as T & GaesupAutoState<T>;
}

export { ensureReady as initGaesupCore };
