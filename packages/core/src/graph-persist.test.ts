import { describe, expect, it, vi } from 'vitest';

import { state, transaction } from './graph';
import { memoryPersistence, webStoragePersistence } from './graph-persist';

function fakeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key: string) => map.get(key) ?? null,
    key: () => null,
    removeItem: (key: string) => void map.delete(key),
    setItem: (key: string, value: string) => void map.set(key, value)
  };
}

describe('persistence', () => {
  it('loads the persisted value instead of the initial value', () => {
    const persist = memoryPersistence<string>();
    persist.save('persisted');

    const theme = state('light', { persist });
    expect(theme.get()).toBe('persisted');
  });

  it('falls back to the initial value when nothing is persisted', () => {
    const theme = state('light', { persist: memoryPersistence<string>() });
    expect(theme.get()).toBe('light');
  });

  it('saves on every committed change', () => {
    const persist = memoryPersistence<number>();
    const save = vi.spyOn(persist, 'save');
    const count = state(0, { persist });

    count.set(1);
    count.set(2);
    expect(save).toHaveBeenCalledTimes(2);
    expect(persist.load()).toBe(2);
  });

  it('persists only the final value of a transaction', () => {
    const persist = memoryPersistence<number>();
    const save = vi.spyOn(persist, 'save');
    const count = state(0, { persist });

    transaction(() => {
      count.set(1);
      count.set(2);
      count.set(3);
    });

    expect(save).toHaveBeenCalledTimes(1);
    expect(persist.load()).toBe(3);
  });

  it('does not persist rolled-back intermediate values', () => {
    const persist = memoryPersistence<number>();
    const count = state(0, { persist });
    count.set(5);

    expect(() =>
      transaction(() => {
        count.set(99);
        throw new Error('abort');
      })
    ).toThrow('abort');

    expect(count.get()).toBe(5);
    expect(persist.load()).toBe(5);
  });

  it('round-trips through web storage with JSON serialization', () => {
    const storage = fakeStorage();
    const first = state({ mode: 'dark' }, { persist: webStoragePersistence('theme', storage) });
    first.set({ mode: 'light' });

    const second = state({ mode: 'dark' }, { persist: webStoragePersistence('theme', storage) });
    expect(second.get()).toEqual({ mode: 'light' });
  });

  it('fail-safe: corrupted storage falls back to the initial value without throwing', () => {
    const storage = fakeStorage();
    storage.setItem('theme', '{not json');

    const theme = state('light', { persist: webStoragePersistence<string>('theme', storage) });
    expect(theme.get()).toBe('light');
  });

  it('fail-safe: a save that throws does not break the state write', () => {
    const persist = {
      load: () => undefined,
      save: () => {
        throw new Error('quota exceeded');
      }
    };
    const count = state(0, { persist });

    expect(() => count.set(1)).not.toThrow();
    expect(count.get()).toBe(1);
  });
});
