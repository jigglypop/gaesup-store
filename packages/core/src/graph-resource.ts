// Graph-native resource (Runtime Spec v0.1 §21-24): server/IO state as a
// dependency-graph node. The key is a derived node, so any state read inside
// `key()` is tracked automatically — when it changes, the resource refetches
// without manual effects or invalidation calls.

import { derived, state } from './graph';

export type GraphResourceStatus = 'idle' | 'loading' | 'success' | 'error';

export interface GraphResourceState<T> {
  data: T | undefined;
  error: unknown;
  status: GraphResourceStatus;
}

export interface GraphResourceOptions<T> {
  id?: string;
  key: () => unknown[];
  fetch: (key: unknown[]) => Promise<T>;
}

export interface GraphResource<T> {
  readonly id: string;
  get(): GraphResourceState<T>;
  subscribe(listener: (snapshot: GraphResourceState<T>) => void): () => void;
  refetch(): Promise<T>;
}

let resourceSeq = 0;

export function graphResource<T>(options: GraphResourceOptions<T>): GraphResource<T> {
  const id = options.id || `resource:${++resourceSeq}`;

  const snapshot = state<GraphResourceState<T>>(
    { data: undefined, error: undefined, status: 'idle' },
    { id: `${id}:state` }
  );

  const keyNode = derived(() => options.key(), {
    id: `${id}:key`,
    equals: (a, b) => JSON.stringify(a) === JSON.stringify(b)
  });

  let fetchSeq = 0;
  let activated = false;

  const runFetch = (key: unknown[]): Promise<T> => {
    const seq = ++fetchSeq;
    snapshot.set((previous) => ({ ...previous, status: 'loading' }));

    let promise: Promise<T>;
    try {
      promise = Promise.resolve(options.fetch(key));
    } catch (error) {
      promise = Promise.reject(error);
    }

    promise.then(
      (data) => {
        if (seq !== fetchSeq) return; // stale response: a newer fetch owns the state
        snapshot.set({ data, error: undefined, status: 'success' });
      },
      (error) => {
        if (seq !== fetchSeq) return;
        snapshot.set((previous) => ({ data: previous.data, error, status: 'error' }));
      }
    );

    return promise;
  };

  const ensureWatching = () => {
    if (activated) return false;
    activated = true;
    keyNode.subscribe((key) => {
      runFetch(key);
    });
    return true;
  };

  return {
    id,
    get() {
      if (ensureWatching()) runFetch(keyNode.get());
      return snapshot.get();
    },
    subscribe(listener) {
      const unsubscribe = snapshot.subscribe(listener);
      if (ensureWatching()) runFetch(keyNode.get());
      return unsubscribe;
    },
    refetch() {
      ensureWatching();
      return runFetch(keyNode.get());
    }
  };
}
