// Graph-native resource (Runtime Spec v0.1 §21-24): server/IO state as a
// dependency-graph node. The key is a derived node, so any state read inside
// `key()` is tracked automatically — when it changes, the resource refetches
// without manual effects or invalidation calls.
//
// Cache layer (§23): per-key entries with staleTime. A fresh hit serves the
// cache without fetching; a stale hit serves the cached data immediately
// (status 'stale') while revalidating in the background. Concurrent fetches
// for the same key are deduplicated. `invalidate()` is the explicit escape
// hatch (§24) — the primary invalidation path stays the dependency graph.

import { derived, state } from './graph';

export type GraphResourceStatus = 'idle' | 'loading' | 'success' | 'error' | 'stale';

export interface GraphResourceState<T> {
  data: T | undefined;
  error: unknown;
  status: GraphResourceStatus;
}

export interface GraphResourceOptions<T> {
  id?: string;
  key: () => unknown[];
  fetch: (key: unknown[]) => Promise<T>;
  staleTime?: number;
}

export interface GraphResource<T> {
  readonly id: string;
  get(): GraphResourceState<T>;
  subscribe(listener: (snapshot: GraphResourceState<T>) => void): () => void;
  refetch(): Promise<T>;
  invalidate(): Promise<void>;
}

let resourceSeq = 0;

export function graphResource<T>(options: GraphResourceOptions<T>): GraphResource<T> {
  const id = options.id || `resource:${++resourceSeq}`;
  const staleTime = options.staleTime ?? 0;

  const snapshot = state<GraphResourceState<T>>(
    { data: undefined, error: undefined, status: 'idle' },
    { id: `${id}:state` }
  );

  const keyNode = derived(() => options.key(), {
    id: `${id}:key`,
    equals: (a, b) => JSON.stringify(a) === JSON.stringify(b)
  });

  const cache = new Map<string, { data: T; updatedAt: number }>();
  const inflight = new Map<string, Promise<T>>();
  let fetchSeq = 0;
  let activated = false;

  const runFetch = (key: unknown[], force = false): Promise<T> => {
    const keyStr = JSON.stringify(key);

    const existing = inflight.get(keyStr);
    if (existing) return existing;

    const cached = cache.get(keyStr);
    if (!force && cached && staleTime > 0 && Date.now() - cached.updatedAt < staleTime) {
      snapshot.set({ data: cached.data, error: undefined, status: 'success' });
      return Promise.resolve(cached.data);
    }

    const seq = ++fetchSeq;
    snapshot.set((previous) =>
      cached
        ? { data: cached.data, error: undefined, status: 'stale' }
        : { ...previous, status: 'loading' }
    );

    let promise: Promise<T>;
    try {
      promise = Promise.resolve(options.fetch(key));
    } catch (error) {
      promise = Promise.reject(error);
    }
    inflight.set(keyStr, promise);

    promise.then(
      (data) => {
        inflight.delete(keyStr);
        cache.set(keyStr, { data, updatedAt: Date.now() });
        if (seq !== fetchSeq) return; // stale response: a newer fetch owns the state
        snapshot.set({ data, error: undefined, status: 'success' });
      },
      (error) => {
        inflight.delete(keyStr);
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
      return runFetch(keyNode.get(), true);
    },
    async invalidate() {
      cache.clear();
      if (activated) await runFetch(keyNode.get(), true);
    }
  };
}
