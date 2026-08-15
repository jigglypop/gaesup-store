// Persistence adapters for graph state (Runtime Spec v0.1 §31). A state node
// created with { persist } loads its initial value from the adapter and saves
// every committed change. Adapter failures are contained: a broken save never
// breaks the state write, a corrupted load falls back to the initial value.

export interface PersistenceAdapter<T> {
  load(): T | undefined;
  save(value: T): void;
}

export function memoryPersistence<T>(): PersistenceAdapter<T> {
  let stored: T | undefined;
  let present = false;
  return {
    load: () => (present ? stored : undefined),
    save(value) {
      stored = value;
      present = true;
    }
  };
}

export function webStoragePersistence<T>(key: string, storage: Storage): PersistenceAdapter<T> {
  return {
    load() {
      try {
        const raw = storage.getItem(key);
        if (raw === null) return undefined;
        return JSON.parse(raw) as T;
      } catch {
        return undefined;
      }
    },
    save(value) {
      try {
        storage.setItem(key, JSON.stringify(value));
      } catch {
        // Quota/serialization failures must not break the state write.
      }
    }
  };
}
