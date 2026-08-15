// Container runtime for the graph plane (Runtime Spec v0.1 §6-13, §42-44,
// §73-74 / MVP 0.5). Containers declare a setup factory and optional
// dependencies; the runtime owns their lifecycle state machine, starts
// dependencies in topological order, wires exposed interfaces into the mesh,
// and isolates failures per container.

import { createGraphMesh, type ConsumeOptions, type GraphMesh } from './graph-mesh';

export type ContainerStatus =
  | 'CREATED'
  | 'RESOLVING'
  | 'READY'
  | 'STARTING'
  | 'ACTIVE'
  | 'SUSPENDED'
  | 'STOPPING'
  | 'STOPPED'
  | 'FAILED'
  | 'DESTROYED';

export type ContainerHealth = 'healthy' | 'degraded' | 'failed';

export type GraphRuntimeErrorCode =
  | 'GAESUP_CONTAINER_NOT_FOUND'
  | 'GAESUP_CONTAINER_ALREADY_REGISTERED'
  | 'GAESUP_INVALID_TRANSITION'
  | 'GAESUP_DEPENDENCY_CYCLE';

export class GraphRuntimeError extends Error {
  constructor(
    readonly code: GraphRuntimeErrorCode,
    message: string
  ) {
    super(`${code}: ${message}`);
    this.name = 'GraphRuntimeError';
  }
}

export interface ContainerContext {
  container: { name: string; version: string | undefined };
  env: Record<string, string>;
  consume<T = unknown>(address: string, options?: ConsumeOptions): T;
}

export interface ContainerSetupResult {
  exposes?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface ContainerDefinition {
  name: string;
  version?: string;
  dependencies?: string[];
  setup(ctx: ContainerContext): ContainerSetupResult;
}

export interface ContainerError {
  container: string;
  phase: 'resolve' | 'setup';
  cause: unknown;
  timestamp: number;
}

export interface ContainerInfo {
  name: string;
  version: string | undefined;
  status: ContainerStatus;
}

export interface GraphRuntimeOptions {
  containers?: ContainerDefinition[];
  env?: Record<string, string>;
}

export interface GraphRuntime {
  register(definition: ContainerDefinition): void;
  unregister(name: string): void;
  start(name: string): void;
  startAll(): void;
  stop(name: string): void;
  suspend(name: string): void;
  resume(name: string): void;
  destroy(name: string): void;
  status(name: string): ContainerStatus;
  health(name: string): ContainerHealth;
  containers(): ContainerInfo[];
  consume<T = unknown>(address: string, options?: ConsumeOptions): T;
  onContainerError(listener: (error: ContainerError) => void): () => void;
  readonly mesh: GraphMesh;
}

interface ContainerRecord {
  definition: ContainerDefinition;
  status: ContainerStatus;
  degradedDeps: Set<string>;
  instance: ContainerSetupResult | undefined;
}

// Invariant I5: only these lifecycle transitions exist (§10).
const TRANSITIONS: Record<ContainerStatus, ContainerStatus[]> = {
  CREATED: ['RESOLVING', 'DESTROYED'],
  RESOLVING: ['READY', 'FAILED'],
  READY: ['STARTING'],
  STARTING: ['ACTIVE', 'FAILED'],
  ACTIVE: ['SUSPENDED', 'STOPPING'],
  SUSPENDED: ['ACTIVE', 'STOPPING'],
  STOPPING: ['STOPPED'],
  STOPPED: ['DESTROYED'],
  FAILED: ['DESTROYED'],
  DESTROYED: []
};

export function defineContainer(definition: ContainerDefinition): ContainerDefinition {
  return definition;
}

export function createRuntime(options: GraphRuntimeOptions = {}): GraphRuntime {
  const mesh = createGraphMesh();
  const env = options.env || {};
  const records = new Map<string, ContainerRecord>();
  const errorListeners = new Set<(error: ContainerError) => void>();

  const record = (name: string): ContainerRecord => {
    const found = records.get(name);
    if (!found) {
      throw new GraphRuntimeError('GAESUP_CONTAINER_NOT_FOUND', `container "${name}" is not registered`);
    }
    return found;
  };

  const transition = (name: string, entry: ContainerRecord, to: ContainerStatus) => {
    if (!TRANSITIONS[entry.status].includes(to)) {
      throw new GraphRuntimeError(
        'GAESUP_INVALID_TRANSITION',
        `container "${name}": ${entry.status} -> ${to} is not a defined transition`
      );
    }
    entry.status = to;
  };

  const reportError = (name: string, phase: ContainerError['phase'], cause: unknown) => {
    const error: ContainerError = { container: name, phase, cause, timestamp: Date.now() };
    for (const listener of errorListeners) listener(error);
  };

  const startInternal = (name: string, chain: string[]) => {
    const entry = record(name);
    if (entry.status === 'ACTIVE') return;
    if (entry.status === 'FAILED') return; // failure already reported; dependents resolve against it

    if (chain.includes(name)) {
      throw new GraphRuntimeError(
        'GAESUP_DEPENDENCY_CYCLE',
        [...chain.slice(chain.indexOf(name)), name].join(' -> ')
      );
    }

    transition(name, entry, 'RESOLVING');
    const nextChain = [...chain, name];
    for (const dependency of entry.definition.dependencies || []) {
      const dependencyEntry = record(dependency);
      if (dependencyEntry.status !== 'ACTIVE') startInternal(dependency, nextChain);
      if (dependencyEntry.status !== 'ACTIVE') {
        transition(name, entry, 'FAILED');
        reportError(name, 'resolve', new Error(`required dependency "${dependency}" is not ACTIVE`));
        return;
      }
    }
    transition(name, entry, 'READY');

    transition(name, entry, 'STARTING');
    const context: ContainerContext = {
      container: { name, version: entry.definition.version },
      env,
      consume<T>(address: string, consumeOptions: ConsumeOptions = {}): T {
        const value = mesh.consume<T>(address, { consumer: name, ...consumeOptions });
        if (value === undefined && consumeOptions.required === false) {
          entry.degradedDeps.add(address);
        }
        return value;
      }
    };
    try {
      const instance = entry.definition.setup(context);
      entry.instance = instance;
      if (instance && instance.exposes) mesh.expose(name, instance.exposes);
      transition(name, entry, 'ACTIVE');
    } catch (cause) {
      transition(name, entry, 'FAILED');
      reportError(name, 'setup', cause);
    }
  };

  const runtime: GraphRuntime = {
    mesh,

    register(definition) {
      if (records.has(definition.name)) {
        throw new GraphRuntimeError(
          'GAESUP_CONTAINER_ALREADY_REGISTERED',
          `container "${definition.name}" is already registered`
        );
      }
      records.set(definition.name, {
        definition,
        status: 'CREATED',
        degradedDeps: new Set(),
        instance: undefined
      });
    },

    unregister(name) {
      record(name);
      records.delete(name);
      mesh.unexpose(name);
    },

    start(name) {
      startInternal(name, []);
    },

    startAll() {
      for (const name of records.keys()) {
        const entry = records.get(name)!;
        if (entry.status === 'CREATED') startInternal(name, []);
      }
    },

    stop(name) {
      const entry = record(name);
      transition(name, entry, 'STOPPING');
      transition(name, entry, 'STOPPED');
    },

    suspend(name) {
      transition(name, record(name), 'SUSPENDED');
    },

    resume(name) {
      const entry = record(name);
      if (entry.status !== 'SUSPENDED') {
        throw new GraphRuntimeError(
          'GAESUP_INVALID_TRANSITION',
          `container "${name}": ${entry.status} -> ACTIVE is not a defined transition`
        );
      }
      entry.status = 'ACTIVE';
    },

    destroy(name) {
      const entry = record(name);
      transition(name, entry, 'DESTROYED');
      mesh.unexpose(name);
      entry.instance = undefined;
    },

    status(name) {
      return record(name).status;
    },

    health(name) {
      const entry = record(name);
      if (entry.status === 'FAILED') return 'failed';
      if (entry.degradedDeps.size > 0) return 'degraded';
      for (const dependency of entry.definition.dependencies || []) {
        const dependencyEntry = records.get(dependency);
        if (!dependencyEntry || dependencyEntry.status !== 'ACTIVE') return 'degraded';
      }
      return 'healthy';
    },

    containers() {
      return [...records.entries()].map(([name, entry]) => ({
        name,
        version: entry.definition.version,
        status: entry.status
      }));
    },

    consume(address, consumeOptions) {
      return mesh.consume(address, consumeOptions);
    },

    onContainerError(listener) {
      errorListeners.add(listener);
      return () => {
        errorListeners.delete(listener);
      };
    }
  };

  for (const definition of options.containers || []) runtime.register(definition);
  return runtime;
}
