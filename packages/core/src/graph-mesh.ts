// Expose/consume mesh (Runtime Spec v0.1 §14, §44): containers publish an
// explicit interface into a namespace; consumers resolve it by address
// ("auth.user") instead of importing internals. Exposed graph nodes are handed
// out as read-only facades so external mutation stays impossible (invariant I2).

export type GraphMeshErrorCode =
  | 'GAESUP_DEPENDENCY_UNAVAILABLE'
  | 'GAESUP_EXPOSE_CONFLICT'
  | 'GAESUP_INVALID_ADDRESS';

export class GraphMeshError extends Error {
  constructor(
    readonly code: GraphMeshErrorCode,
    message: string
  ) {
    super(`${code}: ${message}`);
    this.name = 'GraphMeshError';
  }
}

export interface ConsumedNode<T> {
  readonly id: string;
  get(): T;
  subscribe(listener: (value: T) => void): () => void;
}

export interface ConsumeOptions {
  required?: boolean;
  consumer?: string;
}

export interface DependencyEdge {
  address: string;
  consumer: string | undefined;
  required: boolean;
}

export interface GraphMesh {
  expose(namespace: string, entries: Record<string, unknown>): void;
  unexpose(namespace: string): void;
  consume<T = unknown>(address: string, options?: ConsumeOptions & { required?: true }): T;
  consume<T = unknown>(address: string, options: ConsumeOptions & { required: false }): T | undefined;
  consume<T = unknown>(address: string, options?: ConsumeOptions): T;
  dependencies(): DependencyEdge[];
}

interface NodeLike {
  id?: string;
  get(): unknown;
  subscribe(listener: (value: unknown) => void): () => void;
}

function isNodeLike(value: unknown): value is NodeLike {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as NodeLike).get === 'function' &&
    typeof (value as NodeLike).subscribe === 'function'
  );
}

const ADDRESS_PATTERN = /^[^.\s]+\.[^.\s]+$/;

export function createGraphMesh(): GraphMesh {
  const exposed = new Map<string, unknown>();
  const facades = new Map<string, unknown>();
  const edges: DependencyEdge[] = [];

  return {
    expose(namespace, entries) {
      for (const [key, value] of Object.entries(entries)) {
        const address = `${namespace}.${key}`;
        if (exposed.has(address)) {
          throw new GraphMeshError('GAESUP_EXPOSE_CONFLICT', `"${address}" is already exposed`);
        }
        exposed.set(address, value);
      }
    },

    unexpose(namespace) {
      const prefix = `${namespace}.`;
      for (const address of [...exposed.keys()]) {
        if (address.startsWith(prefix)) {
          exposed.delete(address);
          facades.delete(address);
        }
      }
    },

    consume(address: string, options: ConsumeOptions = {}) {
      if (!ADDRESS_PATTERN.test(address)) {
        throw new GraphMeshError(
          'GAESUP_INVALID_ADDRESS',
          `"${address}" must have the form "namespace.key"`
        );
      }
      const required = options.required !== false;
      edges.push({ address, consumer: options.consumer, required });

      if (!exposed.has(address)) {
        if (required) {
          throw new GraphMeshError('GAESUP_DEPENDENCY_UNAVAILABLE', `"${address}" is not exposed`);
        }
        return undefined as never;
      }

      const value = exposed.get(address);
      if (!isNodeLike(value)) return value as never;

      let facade = facades.get(address);
      if (!facade) {
        const node = value;
        facade = {
          id: node.id || address,
          get: () => node.get(),
          subscribe: (listener: (value: unknown) => void) => node.subscribe(listener)
        } satisfies ConsumedNode<unknown>;
        facades.set(address, facade);
      }
      return facade as never;
    },

    dependencies() {
      return [...edges];
    }
  };
}
