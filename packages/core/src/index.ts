/// <reference path="./wasm.d.ts" />

import initWasm, * as wasm from 'gaesup-state-core-rust/web';
export {
  FrontendSandboxGrid,
  MicroSandboxRuntime,
  SandboxRuntimeError,
  WasmWorkerSandboxContainer,
  assertAllowedWasmImports,
  mountIframeSandboxSlot,
  resolveSandboxCoordinate,
  sandboxCoordinateKey,
  sha256Hex,
  verifyArtifactHash
} from './micro-sandbox';
export {
  FrontendSandboxOrchestrator
} from './sandbox-orchestrator';
export type {
  IframeSandboxSlot,
  MicroSandboxManifest,
  SandboxArtifactSignature,
  SandboxAuditEvent,
  SandboxCapabilityDescriptor,
  SandboxCapabilityRegistry,
  SandboxCoordinate,
  SandboxPermissionContract,
  SandboxRuntimeKind,
  WasmSandboxMetrics
} from './micro-sandbox';
export type {
  SandboxHandle,
  SandboxManifestValidator,
  SandboxOrchestratorOptions,
  SandboxSlotRecord,
  WasmSandboxHandle
} from './sandbox-orchestrator';

export type DependencyConflictPolicy = 'reject' | 'isolate' | 'migrate' | 'readonly' | 'shadow' | 'dual-write';
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
  shadowStoreId?: string;
  dualWriteStoreIds?: string[];
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
  deployment?: HostDeploymentContract;
  requireIntegrity?: boolean;
  requireSignature?: boolean;
  allowedImports?: string[];
  allowedPermissions?: string[];
}

export interface ContainerPackageManifest {
  manifestVersion: string;
  name: string;
  version: string;
  runtime?: string;
  gaesup?: { abiVersion: string; minHostVersion?: string };
  integrity?: { hash?: string; signature?: string };
  dependencies?: PackageDependencyContract[];
  stores?: StoreDependencyContract[];
  accelerators?: AcceleratorDependencyContract[];
  deployment?: ContainerDeploymentContract;
  allowedImports?: string[];
  permissions?: Record<string, any>;
}

export interface DeploymentSlotContract {
  slot: string;
  packageName?: string;
  version?: string;
  releaseId?: string;
  slotVersion?: string;
  contractVersion?: string;
}

export interface HostDeploymentContract {
  releaseId?: string;
  strictRelease?: boolean;
  slots?: DeploymentSlotContract[];
}

export interface ContainerSlotRequirement {
  slot: string;
  releaseId?: string;
  slotVersion?: string;
  contractVersion?: string;
}

export interface ContainerDeploymentContract {
  slot?: string;
  releaseId?: string;
  slotVersion?: string;
  contractVersion?: string;
  requires?: ContainerSlotRequirement[];
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
export type RuntimeTimelineEventType =
  | 'manifest:fetched'
  | 'manifest:validated'
  | 'container:loaded'
  | 'container:created'
  | 'container:stopped'
  | 'store:attached'
  | 'store:isolated'
  | 'store:conflict-rejected'
  | 'store:transitioned'
  | 'machine:transitioned'
  | 'effect:requested'
  | 'effect:denied'
  | 'runtime:error';

export interface RuntimeTimelineEvent {
  type: RuntimeTimelineEventType;
  timestamp: number;
  containerId?: string;
  storeId?: string;
  machineId?: string;
  event?: string;
  durationMs?: number;
  code?: string;
  message?: string;
  details?: Record<string, any>;
}

export interface RuntimeMetricsSnapshot {
  timestamp: number;
  timeline: RuntimeTimelineEvent[];
  droppedTimelineEventCount: number;
  containers: ContainerMetadata[];
  stores: RegisteredStoreSchema[];
  machines: MachineMetricsSnapshot[];
}

export interface StoreRuntimePolicy {
  storeId: string;
  policy: DependencyConflictPolicy;
  shadowStoreId?: string;
  dualWriteStoreIds?: string[];
  migrationCompleted?: boolean;
}

export interface ApplyManifestStorePolicyOptions {
  resolveIsolatedStoreId?: (store: StoreDependencyContract, policy: 'isolate' | 'shadow') => string;
}

let ready: Promise<void> | null = null;
const dispatchListeners = new Map<string, Set<(action: Action, state: any) => void>>();
const runtimeTimeline: RuntimeTimelineEvent[] = [];
const runtimeTimelineListeners = new Set<(event: RuntimeTimelineEvent) => void>();
let droppedTimelineEventCount = 0;
const storeRuntimePolicies = new Map<string, StoreRuntimePolicy>();
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

function pushRuntimeEvent(event: Omit<RuntimeTimelineEvent, 'timestamp'>, notifyListeners = true) {
  const entry: RuntimeTimelineEvent = {
    ...event,
    timestamp: Date.now()
  };
  runtimeTimeline.push(entry);
  if (runtimeTimeline.length > 500) {
    droppedTimelineEventCount += runtimeTimeline.length - 500;
    runtimeTimeline.splice(0, runtimeTimeline.length - 500);
  }
  if (!notifyListeners) return;
  for (const listener of runtimeTimelineListeners) {
    try {
      listener(entry);
    } catch (error) {
      pushRuntimeEvent({
        type: 'runtime:error',
        code: 'TIMELINE_LISTENER_ERROR',
        message: error instanceof Error ? error.message : String(error)
      }, false);
    }
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
    pushRuntimeEvent({
      type: 'store:attached',
      storeId,
      details: { schema: options.schema }
    });
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
    const start = Date.now();
    const legacy = payload === undefined && typeof actionTypeOrPayload !== 'string';
    const storeId = legacy ? 'main' : storeIdOrActionType;
    const actionType = legacy ? storeIdOrActionType : actionTypeOrPayload;
    const actionPayload = legacy ? actionTypeOrPayload : payload;
    assertStoreWriteAllowed(storeId, actionType);
    const targetStoreId = resolveWriteStoreId(storeId);
    const state = await wasm.dispatch(targetStoreId, actionType, actionPayload);
    await dispatchDualWrites(storeId, actionType, actionPayload);
    dispatchListeners.get(storeId)?.forEach((listener) => listener({ type: actionType, payload: actionPayload }, state));
    pushRuntimeEvent({
      type: 'store:transitioned',
      storeId: targetStoreId,
      event: actionType,
      durationMs: Date.now() - start,
      details: storeId === targetStoreId ? undefined : { requestedStoreId: storeId }
    });
    return state;
  },
  async dispatchWithMetadata(storeId: string, actionType: string, payload?: any) {
    await ensureReady();
    const start = Date.now();
    assertStoreWriteAllowed(storeId, actionType);
    const targetStoreId = resolveWriteStoreId(storeId);
    const result = await (wasm as any).dispatch_with_metadata(targetStoreId, actionType, payload);
    await dispatchDualWrites(storeId, actionType, payload);
    dispatchListeners.get(storeId)?.forEach((listener) => listener({ type: actionType, payload }, result.state));
    pushRuntimeEvent({
      type: 'store:transitioned',
      storeId: targetStoreId,
      event: actionType,
      durationMs: Date.now() - start,
      details: { changedPaths: result.changedPaths || [], requestedStoreId: storeId }
    });
    return result as { state: any; changedPaths: string[] };
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
    return wasm.select(resolveReadStoreId(storeId), path || '');
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
  async getMachineMetrics(machineId: string): Promise<MachineMetricsSnapshot> {
    await ensureReady();
    return (wasm as any).get_machine_metrics(machineId) as MachineMetricsSnapshot;
  },
  async getRuntimeMetrics(): Promise<RuntimeMetricsSnapshot> {
    await ensureReady();
    return {
      timestamp: Date.now(),
      timeline: [...runtimeTimeline],
      droppedTimelineEventCount,
      containers: wasm.list_containers() as ContainerMetadata[],
      stores: wasm.get_store_schemas() as RegisteredStoreSchema[],
      machines: (wasm as any).list_machine_metrics() as MachineMetricsSnapshot[]
    };
  },
  getRuntimeTimeline() {
    return [...runtimeTimeline];
  },
  subscribeRuntimeTimeline(listener: (event: RuntimeTimelineEvent) => void): () => void {
    runtimeTimelineListeners.add(listener);
    return () => {
      runtimeTimelineListeners.delete(listener);
    };
  },
  recordRuntimeEvent(event: Omit<RuntimeTimelineEvent, 'timestamp'>) {
    pushRuntimeEvent(event);
  },
  registerStoreSchema(schema: RegisteredStoreSchema) {
    requireReady();
    return wasm.register_store_schema(schema);
  },
  setStoreRuntimePolicy(policy: StoreRuntimePolicy) {
    storeRuntimePolicies.set(policy.storeId, policy);
    if (policy.policy === 'isolate' || policy.policy === 'shadow') {
      pushRuntimeEvent({
        type: 'store:isolated',
        storeId: policy.storeId,
        details: { shadowStoreId: policy.shadowStoreId, policy: policy.policy }
      });
    }
  },
  applyManifestStorePolicies(
    manifest: ContainerPackageManifest,
    validation: ValidationResult,
    options: ApplyManifestStorePolicyOptions = {}
  ) {
    if (!validation.valid) {
      const error = new Error(validation.errors[0]?.message || `Manifest ${manifest.name} failed validation`);
      for (const conflict of validation.errors.filter((issue) => issue.code === 'STORE_SCHEMA_CONFLICT')) {
        pushRuntimeEvent({
          type: 'store:conflict-rejected',
          storeId: conflict.target,
          code: 'STORE_SCHEMA_CONFLICT',
          message: conflict.message,
          details: { manifest: manifest.name }
        });
      }
      pushRuntimeEvent({
        type: 'runtime:error',
        code: validation.errors[0]?.code || 'MANIFEST_VALIDATION_FAILED',
        message: error.message,
        details: { manifest: manifest.name }
      });
      throw error;
    }

    for (const store of manifest.stores || []) {
      const code = runtimePolicyIssueCode(validation, store.storeId);
      if (!code) continue;

      if (code === 'STORE_SCHEMA_READONLY') {
        this.setStoreRuntimePolicy({ storeId: store.storeId, policy: 'readonly' });
        continue;
      }

      if (code === 'STORE_SCHEMA_MIGRATION_REQUIRED') {
        this.setStoreRuntimePolicy({ storeId: store.storeId, policy: 'migrate', migrationCompleted: false });
        continue;
      }

      if (code === 'STORE_SCHEMA_ISOLATED' || code === 'STORE_SCHEMA_SHADOWED') {
        const policy = code === 'STORE_SCHEMA_ISOLATED' ? 'isolate' : 'shadow';
        this.setStoreRuntimePolicy({
          storeId: store.storeId,
          policy,
          shadowStoreId: store.shadowStoreId || options.resolveIsolatedStoreId?.(store, policy) || `${store.storeId}:${policy}`
        });
        continue;
      }

      if (code === 'STORE_SCHEMA_DUAL_WRITE') {
        if (!store.dualWriteStoreIds?.length) {
          const message = `Store ${store.storeId} dual-write policy requires runtime dualWriteStoreIds`;
          pushRuntimeEvent({
            type: 'runtime:error',
            storeId: store.storeId,
            code: 'STORE_DUAL_WRITE_TARGETS_MISSING',
            message
          });
          throw new Error(message);
        }
        this.setStoreRuntimePolicy({
          storeId: store.storeId,
          policy: 'dual-write',
          dualWriteStoreIds: store.dualWriteStoreIds
        });
      }
    }
  },
  completeStoreMigration(storeId: string) {
    const policy = storeRuntimePolicies.get(storeId);
    if (!policy || policy.policy !== 'migrate') {
      throw new Error(`Store ${storeId} does not have an active migrate policy`);
    }
    storeRuntimePolicies.set(storeId, {
      ...policy,
      migrationCompleted: true
    });
    pushRuntimeEvent({
      type: 'store:attached',
      storeId,
      details: { policy: 'migrate', migrationCompleted: true }
    });
  },
  async migrateStore<TState = unknown>(
    storeId: string,
    migration: (state: TState) => TState | Promise<TState>
  ) {
    await ensureReady();
    const policy = storeRuntimePolicies.get(storeId);
    if (!policy || policy.policy !== 'migrate') {
      throw new Error(`Store ${storeId} does not have an active migrate policy`);
    }
    if (policy.migrationCompleted === true) {
      throw new Error(`Store ${storeId} migration is already completed`);
    }

    try {
      const current = wasm.select(storeId, '') as TState;
      const next = await migration(clonePlain(current));
      await wasm.dispatch(storeId, 'SET', clonePlain(next));
      this.completeStoreMigration(storeId);
      return next;
    } catch (error) {
      const resolved = error instanceof Error ? error : new Error(String(error));
      pushRuntimeEvent({
        type: 'runtime:error',
        storeId,
        code: 'STORE_MIGRATION_FAILED',
        message: resolved.message
      });
      throw resolved;
    }
  },
  clearStoreRuntimePolicy(storeId: string) {
    storeRuntimePolicies.delete(storeId);
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
  registerReducer() {
    throw new Error('Reducers must be compiled into the Rust WASM core path');
  }
};

const callbackRegistry = new Map<string, (state?: any) => void>();

function runtimePolicyIssueCode(validation: ValidationResult, storeId: string) {
  const runtimePolicyCodes = new Set([
    'STORE_SCHEMA_ISOLATED',
    'STORE_SCHEMA_SHADOWED',
    'STORE_SCHEMA_READONLY',
    'STORE_SCHEMA_MIGRATION_REQUIRED',
    'STORE_SCHEMA_DUAL_WRITE'
  ]);
  return [...validation.warnings, ...validation.errors]
    .find((issue) => issue.target === storeId && runtimePolicyCodes.has(issue.code))
    ?.code;
}

function resolveReadStoreId(storeId: string) {
  const policy = storeRuntimePolicies.get(storeId);
  assertStoreMigrationCompleted(storeId, policy, 'read');
  if ((policy?.policy === 'isolate' || policy?.policy === 'shadow') && policy.shadowStoreId) {
    return policy.shadowStoreId;
  }
  return storeId;
}

function resolveWriteStoreId(storeId: string) {
  const policy = storeRuntimePolicies.get(storeId);
  assertStoreMigrationCompleted(storeId, policy, 'write');
  if ((policy?.policy === 'isolate' || policy?.policy === 'shadow') && policy.shadowStoreId) {
    return policy.shadowStoreId;
  }
  return storeId;
}

function assertStoreMigrationCompleted(
  storeId: string,
  policy: StoreRuntimePolicy | undefined,
  operation: 'read' | 'write'
) {
  if (policy?.policy !== 'migrate' || policy.migrationCompleted === true) return;

  const error = new Error(`Store ${storeId} requires migration before shared store ${operation}`);
  pushRuntimeEvent({
    type: 'runtime:error',
    storeId,
    code: 'STORE_MIGRATION_REQUIRED',
    message: error.message,
    details: { operation }
  });
  throw error;
}

function assertStoreWriteAllowed(storeId: string, actionType: string) {
  const policy = storeRuntimePolicies.get(storeId);
  if (policy?.policy !== 'readonly') return;

  const error = new Error(`Store ${storeId} is readonly; rejected write action ${actionType}`);
  pushRuntimeEvent({
    type: 'runtime:error',
    storeId,
    event: actionType,
    code: 'STORE_READONLY_WRITE_DENIED',
    message: error.message
  });
  throw error;
}

async function dispatchDualWrites(storeId: string, actionType: string, payload: any) {
  const policy = storeRuntimePolicies.get(storeId);
  if (policy?.policy !== 'dual-write' || !policy.dualWriteStoreIds?.length) return;

  for (const targetStoreId of policy.dualWriteStoreIds) {
    if (targetStoreId === storeId) continue;
    await wasm.dispatch(targetStoreId, actionType, payload);
    pushRuntimeEvent({
      type: 'store:transitioned',
      storeId: targetStoreId,
      event: actionType,
      details: {
        dualWriteSourceStoreId: storeId
      }
    });
  }
}

function validateManifestWithAudit(
  manifest: ContainerPackageManifest,
  host: HostCompatibilityConfig
): ValidationResult {
  requireReady();
  const result = wasm.validate_manifest(manifest, host) as ValidationResult;
  pushRuntimeEvent({
    type: 'manifest:validated',
    details: {
      manifest: manifest.name,
      valid: result.valid,
      errorCodes: result.errors.map((error) => error.code)
    }
  });
  return result;
}

export class CompatibilityGuard {
  constructor(private readonly host: HostCompatibilityConfig = {}) {}
  validate(manifest: ContainerPackageManifest): ValidationResult {
    return validateManifestWithAudit(manifest, this.host);
  }
  static validate(manifest: ContainerPackageManifest, host: HostCompatibilityConfig = {}) {
    return validateManifestWithAudit(manifest, host);
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

function assertContainerManagerRuntime(config: ContainerConfig) {
  const runtime = config.runtime?.toLowerCase();
  if (!runtime || runtime === 'in-memory' || runtime === 'demo') return;

  if (runtime === 'wasm' || runtime === 'wasm-worker' || runtime === 'worker' || runtime === 'iframe') {
    const message = `ContainerManager cannot attach ${config.runtime} containers directly; use MicroSandboxRuntime or FrontendSandboxOrchestrator for artifact, import, and permission enforcement`;
    pushRuntimeEvent({
      type: 'runtime:error',
      containerId: config.id,
      code: 'CONTAINER_RUNTIME_REQUIRES_SANDBOX',
      message,
      details: {
        name: config.name,
        runtime: config.runtime
      }
    });
    const error = new Error(message) as Error & { code?: string };
    error.code = 'CONTAINER_RUNTIME_REQUIRES_SANDBOX';
    throw error;
  }

  const message = `Unsupported ContainerManager runtime: ${config.runtime}`;
  pushRuntimeEvent({
    type: 'runtime:error',
    containerId: config.id,
    code: 'CONTAINER_RUNTIME_UNSUPPORTED',
    message,
    details: {
      name: config.name,
      runtime: config.runtime
    }
  });
  const error = new Error(message) as Error & { code?: string };
  error.code = 'CONTAINER_RUNTIME_UNSUPPORTED';
  throw error;
}

export class ContainerManager {
  private listeners = new Map<ContainerEventType, Set<(event: ContainerEvent) => void>>();
  constructor(readonly config: ContainerManagerConfig = {}) {}
  async createContainer(config: ContainerConfig) {
    await ensureReady();
    assertContainerManagerRuntime(config);
    const created = wasm.create_container(config);
    const instance = new ContainerInstance(created.id);
    pushRuntimeEvent({
      type: 'container:created',
      containerId: created.id,
      details: { name: config.name, runtime: config.runtime }
    });
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

export class DemoContainerManager extends ContainerManager {}

/**
 * @deprecated This manager does not attach external WASM artifacts. Use
 * DemoContainerManager for the in-memory/demo lifecycle path, or
 * MicroSandboxRuntime/FrontendSandboxOrchestrator for real WASM sandbox attach.
 */
export class WASMContainerManager extends DemoContainerManager {}

export async function createOptimalContainerManager(config: ContainerManagerConfig = {}) {
  await ensureReady();
  return new DemoContainerManager(config);
}

export class ReduxDevToolsBridge {
  containerCreated(containerId: string, details: Record<string, any> = {}) {
    pushRuntimeEvent({ type: 'container:created', containerId, details });
  }
  functionCalled(containerId: string, functionName: string, details: Record<string, any> = {}) {
    pushRuntimeEvent({
      type: 'container:loaded',
      containerId,
      event: functionName,
      details
    });
  }
  errorOccurred(error: Error | string, details: Record<string, any> = {}) {
    const resolved = error instanceof Error ? error : new Error(error);
    pushRuntimeEvent({
      type: 'runtime:error',
      message: resolved.message,
      details
    });
  }
  getTimeline() {
    return [...runtimeTimeline];
  }
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

export type MachineStatus = 'active' | 'final' | 'error';

export interface MachineTransitionConfig {
  target?: string;
  guard?: string | { path: string; op?: string; value?: any };
  cond?: string | { path: string; op?: string; value?: any };
  action?: string | string[] | Record<string, any>;
  actions?: string | string[] | Record<string, any>;
  assign?: Record<string, any>;
}

export interface MachineStateConfig {
  final?: boolean;
  entry?: string | string[] | Record<string, any>;
  exit?: string | string[] | Record<string, any>;
  on?: Record<string, string | MachineTransitionConfig | MachineTransitionConfig[]>;
}

export interface MachineDefinition<TContext = any> {
  id: string;
  initial: string;
  context?: TContext;
  states: Record<string, MachineStateConfig>;
}

export interface MachineHistoryEntry {
  from: string;
  to: string;
  event: string;
  timestamp: number;
  durationMs: number;
}

export interface MachineEffectDescriptor {
  id: string;
  type: string;
  payload?: any;
  permission?: string;
}

export interface MachineSnapshot<TContext = any> {
  machineId: string;
  state: string;
  context: TContext;
  status: MachineStatus;
  step: number;
  history: MachineHistoryEntry[];
  changed: boolean;
  actions: MachineEffectDescriptor[];
}

export interface MachineMetricsSnapshot {
  machineId: string;
  state: string;
  status: MachineStatus;
  step: number;
  historyAvailable: boolean;
  historyTruncated: boolean;
  transitionCount: number;
  avgDurationMs: number | null;
  maxDurationMs: number | null;
}

export interface MachineTransitionResult<TContext = any> {
  accepted: boolean;
  snapshot: MachineSnapshot<TContext>;
  rejectedReason?: string;
  effects: MachineEffectDescriptor[];
  effectResults?: Array<{ effect: MachineEffectDescriptor; status: 'resolved' | 'rejected' | 'denied'; result?: any; error?: any }>;
}

export interface GaesupMachine<TContext = any> {
  id: string;
  definition: MachineDefinition<TContext>;
}

export interface MachineActorOptions<TContext = any> {
  storeId?: string;
  context?: TContext;
  guards?: Record<string, (input: { context: TContext; event: any; snapshot?: MachineSnapshot<TContext> }) => boolean>;
  effects?: Record<string, (input: { payload: any; event?: any; snapshot: MachineSnapshot<TContext> }) => any | Promise<any>>;
  allowedEffects?: string[];
  executeEffects?: boolean;
}

export interface GaesupMachineActor<TContext = any> {
  readonly id: string;
  start(): Promise<MachineSnapshot<TContext>>;
  send(event: string | Record<string, any>): Promise<MachineTransitionResult<TContext>>;
  subscribe(listener: (snapshot: MachineSnapshot<TContext>) => void): () => void;
  getSnapshot(): MachineSnapshot<TContext> | undefined;
  rollback(options?: { steps?: number }): Promise<MachineTransitionResult<TContext>>;
  stop(): void;
}

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

export function createMachine<TContext = any>(definition: MachineDefinition<TContext>): GaesupMachine<TContext> {
  return {
    id: definition.id,
    definition
  };
}

export function createActor<TContext = any>(
  machine: GaesupMachine<TContext> | MachineDefinition<TContext>,
  options: MachineActorOptions<TContext> = {}
): GaesupMachineActor<TContext> {
  const definition = 'definition' in machine ? machine.definition : machine;
  let wasmMachineId: string | null = null;
  let currentSnapshot: MachineSnapshot<TContext> | undefined;
  const listeners = new Set<(snapshot: MachineSnapshot<TContext>) => void>();

  const notify = () => {
    if (!currentSnapshot) return;
    listeners.forEach((listener) => listener(currentSnapshot!));
  };

  const persistSnapshot = async () => {
    if (!options.storeId || !currentSnapshot) return;
    await ensureMachineStore(options.storeId);
    await GaesupCore.dispatch(options.storeId, 'UPDATE', {
      path: `machines.${definition.id}`,
      value: currentSnapshot
    });
  };

  const ensureStarted = async () => {
    if (wasmMachineId) return wasmMachineId;
    await ensureReady();
    wasmMachineId = await (wasm as any).create_machine(definition);
    const snapshot = await (wasm as any).start_machine(
      wasmMachineId,
      options.context === undefined ? null : clonePlain(options.context)
    );
    currentSnapshot = snapshot as MachineSnapshot<TContext>;
    await persistSnapshot();
    notify();
    return wasmMachineId;
  };

  const api: GaesupMachineActor<TContext> = {
    id: definition.id,
    async start() {
      await ensureStarted();
      return currentSnapshot!;
    },
    async send(eventInput: string | Record<string, any>) {
      const id = await ensureStarted();
      const start = Date.now();
      const event = normalizeMachineEvent(eventInput);
      event.__guards = evaluateMachineGuards(options.guards || {}, currentSnapshot, event);
      const result = await (wasm as any).send_machine(id, clonePlain(event)) as MachineTransitionResult<TContext>;
      currentSnapshot = result.snapshot;
      result.effectResults = await runMachineEffects(result.effects || [], options, currentSnapshot, event);
      pushRuntimeEvent({
        type: 'machine:transitioned',
        machineId: definition.id,
        event: event.type,
        durationMs: Date.now() - start,
        details: {
          accepted: result.accepted,
          state: currentSnapshot.state,
          rejectedReason: result.rejectedReason,
          effects: result.effects?.map((effect) => effect.type) || []
        }
      });
      await persistSnapshot();
      notify();
      return result;
    },
    subscribe(listener) {
      listeners.add(listener);
      if (currentSnapshot) listener(currentSnapshot);
      return () => listeners.delete(listener);
    },
    getSnapshot() {
      return currentSnapshot;
    },
    async rollback(rollbackOptions = {}) {
      const id = await ensureStarted();
      const result = await (wasm as any).rollback_machine(id, rollbackOptions.steps || 1) as MachineTransitionResult<TContext>;
      currentSnapshot = result.snapshot;
      pushRuntimeEvent({
        type: 'machine:transitioned',
        machineId: definition.id,
        event: 'rollback',
        details: {
          accepted: result.accepted,
          state: currentSnapshot.state,
          steps: rollbackOptions.steps || 1
        }
      });
      await persistSnapshot();
      notify();
      return result;
    },
    stop() {
      if (wasmMachineId) {
        (wasm as any).cleanup_machine(wasmMachineId);
        wasmMachineId = null;
      }
      listeners.clear();
    }
  };

  return api;
}

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

function normalizeMachineEvent(event: string | Record<string, any>): Record<string, any> {
  return typeof event === 'string' ? { type: event } : { ...event };
}

function evaluateMachineGuards<TContext>(
  guards: NonNullable<MachineActorOptions<TContext>['guards']>,
  snapshot: MachineSnapshot<TContext> | undefined,
  event: any
) {
  const output: Record<string, boolean> = {};
  for (const [name, guard] of Object.entries(guards)) {
    try {
      output[name] = !!guard({
        context: (snapshot?.context ?? {}) as TContext,
        event,
        snapshot
      });
    } catch {
      output[name] = false;
    }
  }
  return output;
}

async function runMachineEffects<TContext>(
  effects: MachineEffectDescriptor[],
  options: MachineActorOptions<TContext>,
  snapshot: MachineSnapshot<TContext>,
  event: any
) {
  if (options.executeEffects === false) return [];

  const results: MachineTransitionResult<TContext>['effectResults'] = [];
  const allowed = options.allowedEffects ? new Set(options.allowedEffects) : null;

  for (const effect of effects) {
    const permission = effect.permission || `effects:${effect.type}`;
    const handler = options.effects?.[effect.type];
    if (allowed && !allowed.has(permission) && !allowed.has(effect.type)) {
      pushRuntimeEvent({
        type: 'effect:denied',
        machineId: snapshot.machineId,
        event: effect.type,
        code: 'EFFECT_PERMISSION_DENIED',
        details: { permission }
      });
      results.push({ effect, status: 'denied', error: `Effect permission denied: ${permission}` });
      continue;
    }

    pushRuntimeEvent({
      type: 'effect:requested',
      machineId: snapshot.machineId,
      event: effect.type,
      details: { handled: !!handler, permission }
    });

    if (!handler) {
      results.push({ effect, status: 'resolved', result: undefined });
      continue;
    }

    try {
      const result = await handler({
        payload: effect.payload,
        event,
        snapshot
      });
      results.push({ effect, status: 'resolved', result });
    } catch (error) {
      results.push({ effect, status: 'rejected', error });
    }
  }

  return results;
}

async function ensureMachineStore(storeId: string) {
  try {
    await GaesupCore.createStore(storeId, { machines: {} });
  } catch (error) {
    if (!String((error as any)?.message || error).includes('already exists')) {
      throw error;
    }
  }
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
export * from './micro-sandbox';
export * from './sandbox-orchestrator';
