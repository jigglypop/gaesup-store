// Graph-native stream (Runtime Spec v0.1 §29-30): realtime sources
// (WebSocket, SSE, BroadcastChannel, ...) enter the dependency graph as a
// node. Each pushed value lands in graph state, so derived nodes and
// subscribers downstream react without adapter glue.

import { state } from './graph';

export type GraphStreamStatus = 'idle' | 'active' | 'error' | 'closed';

export interface GraphStreamObserver<T> {
  next(value: T): void;
  error(error: unknown): void;
}

export interface GraphStreamOptions<T> {
  id?: string;
  subscribe(observer: GraphStreamObserver<T>): () => void;
}

export interface GraphStream<T> {
  readonly id: string;
  get(): T | undefined;
  status(): GraphStreamStatus;
  error(): unknown;
  subscribe(listener: (value: T) => void): () => void;
  connect(): void;
  disconnect(): void;
}

let streamSeq = 0;

export function graphStream<T>(options: GraphStreamOptions<T>): GraphStream<T> {
  const id = options.id || `stream:${++streamSeq}`;
  const value = state<T | undefined>(undefined, { id: `${id}:value` });
  const status = state<GraphStreamStatus>('idle', { id: `${id}:status` });
  const lastError = state<unknown>(undefined, { id: `${id}:error` });

  let teardown: (() => void) | null = null;
  // Epoch guard: a source may keep pushing after its teardown was called;
  // events from a stale epoch must never reach graph state.
  let epoch = 0;

  const stopSource = () => {
    epoch += 1;
    const dispose = teardown;
    teardown = null;
    dispose?.();
  };

  const connect = () => {
    if (status.get() === 'active') return;
    const currentEpoch = ++epoch;
    try {
      teardown = options.subscribe({
        next(next) {
          if (currentEpoch !== epoch) return;
          value.set(next);
        },
        error(error) {
          if (currentEpoch !== epoch) return;
          lastError.set(error);
          status.set('error');
          stopSource();
        }
      });
      lastError.set(undefined);
      status.set('active');
    } catch (error) {
      teardown = null;
      lastError.set(error);
      status.set('error');
    }
  };

  return {
    id,
    get() {
      if (status.get() === 'idle') connect();
      return value.get();
    },
    status: () => status.get(),
    error: () => lastError.get(),
    subscribe(listener) {
      const unsubscribe = value.subscribe((next) => listener(next as T));
      if (status.get() === 'idle') connect();
      return unsubscribe;
    },
    connect,
    disconnect() {
      if (status.get() !== 'active') return;
      stopSource();
      status.set('closed');
    }
  };
}
