// Reactive dependency graph: state/derived primitives with automatic
// dependency tracking, dirty propagation limited to the affected subgraph,
// batched notifications, and fail-closed cycle detection.

export type EqualsFn<T> = (a: T, b: T) => boolean;

export interface GraphNodeOptions<T> {
  id?: string;
  equals?: EqualsFn<T>;
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
  const node: StateInternal<T> = {
    kind: 'state',
    id: options.id || `state:${++nodeSeq}`,
    value: initialValue,
    version: 0,
    equals: options.equals || defaultEquals,
    dependents: new Set(),
    listeners: new Set(),
    lastNotifiedValue: initialValue
  };

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
      node.value = resolved;
      node.version += 1;
      globalVersion += 1;
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
