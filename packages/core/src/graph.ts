// Reactive dependency graph: state/derived primitives with automatic
// dependency tracking, dirty propagation limited to the affected subgraph,
// batched notifications, and fail-closed cycle detection.

import type { PersistenceAdapter } from './graph-persist';

export type EqualsFn<T> = (a: T, b: T) => boolean;

export interface GraphNodeOptions<T> {
  id?: string;
  equals?: EqualsFn<T>;
  persist?: PersistenceAdapter<T>;
}

export interface StateNode<T> {
  readonly kind: 'state';
  readonly id: string;
  readonly version: number;
  get(): T;
  set(next: T | ((previous: T) => T)): void;
  subscribe(listener: (value: T) => void): () => void;
}

export interface DerivedNode<T> {
  readonly kind: 'derived';
  readonly id: string;
  readonly version: number;
  get(): T;
  subscribe(listener: (value: T) => void): () => void;
}

export class DependencyCycleError extends Error {
  readonly code = 'GAESUP_DEPENDENCY_CYCLE';
  readonly path: string[];

  constructor(path: string[]) {
    super(`GAESUP_DEPENDENCY_CYCLE: ${path.join(' -> ')}`);
    this.name = 'DependencyCycleError';
    this.path = path;
  }
}

type AnyNode = StateInternal<any> | DerivedInternal<any>;

interface StateInternal<T> {
  kind: 'state';
  id: string;
  value: T;
  version: number;
  equals: EqualsFn<T>;
  dependents: Set<DerivedInternal<any>>;
  listeners: Set<(value: T) => void>;
  lastNotifiedValue: T;
}

interface DerivedInternal<T> {
  kind: 'derived';
  id: string;
  compute: () => T;
  value: T | undefined;
  version: number;
  initialized: boolean;
  computing: boolean;
  lastGlobalVersion: number;
  equals: EqualsFn<T>;
  deps: Map<AnyNode, number>;
  dependents: Set<DerivedInternal<any>>;
  listeners: Set<(value: T) => void>;
  lastNotifiedVersion: number;
}

const defaultEquals = Object.is;

let nodeSeq = 0;
let globalVersion = 0;
let batchDepth = 0;
let activeJournal: Map<StateInternal<any>, any> | null = null;

// --- Trace (§52-53) ---------------------------------------------------------

export interface GraphTraceEvent {
  id: number;
  type: 'state-change' | 'derived-recompute';
  node: string;
  version: number;
  timestamp: number;
}

let traceSeq = 0;
const traceListeners = new Set<(event: GraphTraceEvent) => void>();

export function subscribeGraphTrace(listener: (event: GraphTraceEvent) => void): () => void {
  traceListeners.add(listener);
  return () => {
    traceListeners.delete(listener);
  };
}

function emitTrace(type: GraphTraceEvent['type'], node: string, version: number) {
  if (traceListeners.size === 0) return;
  const event: GraphTraceEvent = { id: ++traceSeq, type, node, version, timestamp: Date.now() };
  for (const listener of traceListeners) {
    try {
      listener(event);
    } catch {
      // A broken trace listener must never break the graph write.
    }
  }
}

// --- State registry for snapshot/restore (§56-57) ---------------------------

const stateRegistry = new Map<string, WeakRef<StateInternal<any>>>();
let activeCompute: DerivedInternal<any> | null = null;
const computeStack: DerivedInternal<any>[] = [];
const pendingNotifications = new Set<AnyNode>();

function track(node: AnyNode, versionAfterRead: number) {
  if (!activeCompute) return;
  activeCompute.deps.set(node, versionAfterRead);
  node.dependents.add(activeCompute);
}

function detachFromDeps(node: DerivedInternal<any>) {
  for (const dep of node.deps.keys()) {
    dep.dependents.delete(node);
  }
  node.deps.clear();
}

function actualize<T>(node: DerivedInternal<T>): void {
  if (node.computing) {
    const start = computeStack.indexOf(node);
    const path = computeStack.slice(start === -1 ? 0 : start).map((entry) => entry.id);
    path.push(node.id);
    throw new DependencyCycleError(path);
  }
  if (node.initialized && node.lastGlobalVersion === globalVersion) return;

  if (node.initialized) {
    let dirty = false;
    for (const [dep, seenVersion] of node.deps) {
      if (dep.kind === 'derived') actualize(dep);
      if (dep.version !== seenVersion) {
        dirty = true;
        break;
      }
    }
    if (!dirty) {
      node.lastGlobalVersion = globalVersion;
      return;
    }
  }

  detachFromDeps(node);
  const previousCompute = activeCompute;
  activeCompute = node;
  node.computing = true;
  computeStack.push(node);
  try {
    const next = node.compute();
    if (!node.initialized || !node.equals(node.value as T, next)) {
      node.value = next;
      node.version += 1;
    }
    node.initialized = true;
    node.lastGlobalVersion = globalVersion;
    emitTrace('derived-recompute', node.id, node.version);
  } finally {
    node.computing = false;
    computeStack.pop();
    activeCompute = previousCompute;
  }
}

function collectAffected(node: AnyNode, visited: Set<AnyNode>) {
  if (visited.has(node)) return;
  visited.add(node);
  if (node.listeners.size > 0) pendingNotifications.add(node);
  for (const dependent of node.dependents) {
    collectAffected(dependent, visited);
  }
}

function flushNotifications() {
  while (pendingNotifications.size > 0) {
    const nodes = [...pendingNotifications];
    pendingNotifications.clear();
    for (const node of nodes) {
      if (node.kind === 'state') {
        if (node.equals(node.lastNotifiedValue, node.value)) continue;
        node.lastNotifiedValue = node.value;
        for (const listener of node.listeners) listener(node.value);
      } else {
        actualize(node);
        if (node.version === node.lastNotifiedVersion) continue;
        node.lastNotifiedVersion = node.version;
        for (const listener of node.listeners) listener(node.value);
      }
    }
  }
}

export function state<T>(initialValue: T, options: GraphNodeOptions<T> = {}): StateNode<T> {
  const persist = options.persist;
  let resolvedInitial = initialValue;
  if (persist) {
    try {
      const loaded = persist.load();
      if (loaded !== undefined) resolvedInitial = loaded;
    } catch {
      // Fail-safe: a broken load falls back to the initial value.
    }
  }

  const node: StateInternal<T> = {
    kind: 'state',
    id: options.id || `state:${++nodeSeq}`,
    value: resolvedInitial,
    version: 0,
    equals: options.equals || defaultEquals,
    dependents: new Set(),
    listeners: new Set(),
    lastNotifiedValue: resolvedInitial
  };
  stateRegistry.set(node.id, new WeakRef(node));

  if (persist) {
    // An internal subscriber: committed changes reach the adapter after the
    // flush's equality cutoff, so rollbacks and no-op writes never persist.
    node.listeners.add((value) => {
      try {
        persist.save(value);
      } catch {
        // A failing save must not break the state write or other listeners.
      }
    });
  }

  return {
    kind: 'state',
    id: node.id,
    get version() {
      return node.version;
    },
    get() {
      track(node, node.version);
      return node.value;
    },
    set(next) {
      const resolved =
        typeof next === 'function' ? (next as (previous: T) => T)(node.value) : next;
      if (node.equals(node.value, resolved)) return;
      if (activeJournal && !activeJournal.has(node)) activeJournal.set(node, node.value);
      node.value = resolved;
      node.version += 1;
      globalVersion += 1;
      emitTrace('state-change', node.id, node.version);
      collectAffected(node, new Set());
      if (batchDepth === 0) flushNotifications();
    },
    subscribe(listener) {
      node.listeners.add(listener);
      return () => {
        node.listeners.delete(listener);
      };
    }
  };
}

export function derived<T>(compute: () => T, options: GraphNodeOptions<T> = {}): DerivedNode<T> {
  const node: DerivedInternal<T> = {
    kind: 'derived',
    id: options.id || `derived:${++nodeSeq}`,
    compute,
    value: undefined,
    version: 0,
    initialized: false,
    computing: false,
    lastGlobalVersion: -1,
    equals: options.equals || defaultEquals,
    deps: new Map(),
    dependents: new Set(),
    listeners: new Set(),
    lastNotifiedVersion: 0
  };

  return {
    kind: 'derived',
    id: node.id,
    get version() {
      return node.version;
    },
    get() {
      actualize(node);
      track(node, node.version);
      return node.value as T;
    },
    subscribe(listener) {
      actualize(node);
      node.lastNotifiedVersion = node.version;
      node.listeners.add(listener);
      return () => {
        node.listeners.delete(listener);
      };
    }
  };
}

export function batch<T>(fn: () => T): T {
  batchDepth += 1;
  try {
    return fn();
  } finally {
    batchDepth -= 1;
    if (batchDepth === 0) flushNotifications();
  }
}

function rollbackJournal(journal: Map<StateInternal<any>, any>) {
  for (const [node, previous] of journal) {
    if (node.equals(node.value, previous)) continue;
    node.value = previous;
    node.version += 1;
    globalVersion += 1;
    emitTrace('state-change', node.id, node.version);
    collectAffected(node, new Set());
  }
}

// --- Snapshot / restore (§56-57) --------------------------------------------

export function snapshotGraph(filter?: (id: string) => boolean): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [id, ref] of stateRegistry) {
    const node = ref.deref();
    if (!node) {
      stateRegistry.delete(id);
      continue;
    }
    if (filter && !filter(id)) continue;
    result[id] = node.value;
  }
  return result;
}

// Restores captured values atomically: unknown ids are skipped, unchanged
// values neither notify nor bump versions, and subscribers hear one wave.
export function restoreGraph(snapshot: Record<string, unknown>): void {
  batch(() => {
    for (const [id, value] of Object.entries(snapshot)) {
      const node = stateRegistry.get(id)?.deref();
      if (!node) continue;
      if (node.equals(node.value, value)) continue;
      if (activeJournal && !activeJournal.has(node)) activeJournal.set(node, node.value);
      node.value = value;
      node.version += 1;
      globalVersion += 1;
      emitTrace('state-change', node.id, node.version);
      collectAffected(node, new Set());
    }
  });
}

// Atomic write group (spec §27-28): notifications are deferred until commit,
// so observers never see intermediate state; a throw reverts every write made
// inside (nested transactions join the outermost unit).
export function transaction<T>(fn: () => T): T {
  const parentJournal = activeJournal;
  const journal = parentJournal ?? new Map<StateInternal<any>, any>();
  activeJournal = journal;
  batchDepth += 1;
  try {
    return fn();
  } catch (error) {
    if (!parentJournal) rollbackJournal(journal);
    throw error;
  } finally {
    activeJournal = parentJournal;
    batchDepth -= 1;
    if (batchDepth === 0) flushNotifications();
  }
}

export interface WriteJournal {
  revert(): void;
}

// Applies writes immediately (observers do see them — the optimistic-update
// building block) while journaling previous values for a later revert.
export function recordWrites(fn: () => void): WriteJournal {
  const parentJournal = activeJournal;
  const journal = new Map<StateInternal<any>, any>();
  activeJournal = journal;
  batchDepth += 1;
  try {
    fn();
  } finally {
    activeJournal = parentJournal;
    batchDepth -= 1;
    if (batchDepth === 0) flushNotifications();
  }
  return {
    revert() {
      rollbackJournal(journal);
      if (batchDepth === 0) flushNotifications();
    }
  };
}
