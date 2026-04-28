import { beforeEach, describe, expect, it, vi } from 'vitest';

const calls = vi.hoisted(() => ({
  stores: new Map<string, any>(),
  dispatches: [] as Array<{ storeId: string; actionType: string; payload: any }>
}));

vi.mock('gaesup-state-core-rust/web', () => ({
  default: vi.fn(() => Promise.resolve()),
  init: vi.fn(),
  create_store: vi.fn((storeId: string, initialState: any) => {
    if (calls.stores.has(storeId)) throw new Error(`Store already exists: ${storeId}`);
    calls.stores.set(storeId, structuredClone(initialState));
  }),
  cleanup_store: vi.fn((storeId: string) => {
    calls.stores.delete(storeId);
  }),
  dispatch: vi.fn((storeId: string, actionType: string, payload: any) => {
    calls.dispatches.push({ storeId, actionType, payload: structuredClone(payload) });
    const state = calls.stores.get(storeId) || {};
    if (actionType === 'SET') {
      calls.stores.set(storeId, structuredClone(payload));
      return payload;
    }
    if (actionType === 'UPDATE') {
      setPath(state, payload.path, payload.value);
      return state;
    }
    if (actionType === 'DELETE') {
      deletePath(state, payload.path);
      return state;
    }
    if (actionType === 'BATCH') {
      for (const mutation of payload) {
        if (mutation.actionType === 'UPDATE') setPath(state, mutation.payload.path, mutation.payload.value);
        if (mutation.actionType === 'DELETE') deletePath(state, mutation.payload.path);
      }
      return state;
    }
    if (actionType === 'MERGE') {
      Object.assign(state, payload);
      return state;
    }
    return state;
  }),
  select: vi.fn((storeId: string, path: string) => {
    const state = calls.stores.get(storeId);
    return path ? getPath(state, path) : state;
  }),
  subscribe: vi.fn(() => 'sub:test'),
  unsubscribe: vi.fn(),
  garbage_collect: vi.fn(() => calls.stores.clear()),
  cleanup_containers: vi.fn(),
  create_snapshot: vi.fn(() => 'snapshot:test'),
  restore_snapshot: vi.fn(),
  get_metrics: vi.fn(() => ({})),
  register_store_schema: vi.fn(),
  get_store_schemas: vi.fn(() => []),
  BatchUpdate: class {
    updates: any[] = [];
    constructor(readonly storeId: string) {}
    add_update(actionType: string, payload: any) {
      this.updates.push({ actionType, payload });
    }
    execute() {
      return {};
    }
  }
}));

import { atom, createAutoStore, GaesupCore, gaesup, resource, tx, watch } from './index';

describe('auto store object tracking', () => {
  beforeEach(() => {
    calls.stores.clear();
    calls.dispatches.length = 0;
  });

  it('tracks a nested object pointer mutation', async () => {
    const store = createAutoStore('profile', { user: { name: 'Ada', age: 1 } }, { flushMode: 'manual' });
    await store.ready;

    const user = store.state.user;
    user.name = 'Grace';
    await store.flush();

    expect(calls.dispatches).toEqual([
      { storeId: 'profile', actionType: 'UPDATE', payload: { path: 'user.name', value: 'Grace' } }
    ]);
    expect(calls.stores.get('profile').user.name).toBe('Grace');
  });

  it('returns the same proxy for the same live nested object', async () => {
    const store = createAutoStore('profile', { user: { name: 'Ada' } }, { flushMode: 'manual' });
    await store.ready;

    expect(store.state.user).toBe(store.state.user);
  });

  it('does not let a stale nested pointer patch a replaced object', async () => {
    const store = createAutoStore('profile', { user: { name: 'Ada' } }, { flushMode: 'manual' });
    await store.ready;

    const oldUser = store.state.user;
    store.state.user = { name: 'Grace' };
    oldUser.name = 'Stale';
    await store.flush();

    expect(calls.dispatches).toEqual([
      { storeId: 'profile', actionType: 'UPDATE', payload: { path: 'user', value: { name: 'Grace' } } }
    ]);
    expect(calls.stores.get('profile').user.name).toBe('Grace');
  });

  it('does not let stale delete patch a replaced object', async () => {
    const store = createAutoStore('profile', { user: { name: 'Ada', age: 1 } }, { flushMode: 'manual' });
    await store.ready;

    const oldUser = store.state.user;
    store.state.user = { name: 'Grace', age: 2 };
    delete (oldUser as any).age;
    await store.flush();

    expect(flattenMutations(calls.dispatches)).toEqual([
      { storeId: 'profile', actionType: 'UPDATE', payload: { path: 'user', value: { name: 'Grace', age: 2 } } }
    ]);
    expect(calls.stores.get('profile').user.age).toBe(2);
  });

  it('tracks a nested pointer after reading the replacement from state', async () => {
    const store = createAutoStore(
      'profile',
      { user: { name: 'Ada' } as { name: string; meta?: { visits: number } } },
      { flushMode: 'manual' }
    );
    await store.ready;

    store.state.user = { name: 'Grace', meta: { visits: 1 } };
    const user = store.state.user;
    user.meta!.visits = 2;
    await store.flush();

    expect(flattenMutations(calls.dispatches)).toEqual([
      { storeId: 'profile', actionType: 'UPDATE', payload: { path: 'user', value: { name: 'Grace', meta: { visits: 2 } } } }
    ]);
    expect(calls.stores.get('profile').user.meta.visits).toBe(2);
  });

  it('compresses parent and child patches into the latest parent value', async () => {
    const store = createAutoStore('profile', { user: { name: 'Ada', meta: { visits: 1 } } }, { flushMode: 'manual' });
    await store.ready;

    store.state.user = { name: 'Grace', meta: { visits: 2 } };
    store.state.user.meta.visits = 3;
    await store.flush();

    expect(flattenMutations(calls.dispatches)).toEqual([
      { storeId: 'profile', actionType: 'UPDATE', payload: { path: 'user', value: { name: 'Grace', meta: { visits: 3 } } } }
    ]);
    expect(calls.stores.get('profile').user.meta.visits).toBe(3);
  });

  it('tracks array push from a nested array pointer', async () => {
    const store = createAutoStore('cart', { items: [{ price: 100 }] }, { flushMode: 'manual' });
    await store.ready;

    const items = store.state.items;
    items.push({ price: 200 });
    await store.flush();

    expect(flattenMutations(calls.dispatches).map((call) => call.payload.path)).toContain('items.1');
    expect(calls.stores.get('cart').items[1]).toEqual({ price: 200 });
  });

  it('tracks delete through a nested pointer', async () => {
    const store = createAutoStore('profile', { user: { name: 'Ada', age: 1 } }, { flushMode: 'manual' });
    await store.ready;

    const user = store.state.user;
    delete (user as any).age;
    await store.flush();

    expect(calls.dispatches).toEqual([
      { storeId: 'profile', actionType: 'DELETE', payload: { path: 'user.age' } }
    ]);
    expect(calls.stores.get('profile').user.age).toBeUndefined();
  });

  it('auto flushes changed paths in a microtask', async () => {
    const store = createAutoStore('profile', { user: { name: 'Ada' } });
    await store.ready;

    store.state.user.name = 'Grace';
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(calls.dispatches).toEqual([
      { storeId: 'profile', actionType: 'UPDATE', payload: { path: 'user.name', value: 'Grace' } }
    ]);
  });

  it('captures raw external object changes when the parent patch is still pending', async () => {
    const store = createAutoStore('profile', { user: { name: 'Ada' } }, { flushMode: 'manual' });
    await store.ready;
    const external = { name: 'Grace' };

    store.state.user = external;
    external.name = 'Raw pointer';
    await store.flush();

    expect(flattenMutations(calls.dispatches)).toEqual([
      { storeId: 'profile', actionType: 'UPDATE', payload: { path: 'user', value: { name: 'Raw pointer' } } }
    ]);
    expect(calls.stores.get('profile').user.name).toBe('Raw pointer');
  });
});

describe('minimal interfaces', () => {
  beforeEach(() => {
    calls.stores.clear();
    calls.dispatches.length = 0;
  });

  it('creates an auto-id store with gaesup(initial)', async () => {
    const state = gaesup({ count: 0 }, { flushMode: 'manual' });
    await state.$ready;

    state.count += 1;
    await state.$flush();

    expect(state.$id).toMatch(/^store:/);
    expect(calls.dispatches).toEqual([
      { storeId: state.$id, actionType: 'UPDATE', payload: { path: 'count', value: 1 } }
    ]);
  });

  it('supports transaction flush', async () => {
    const state = gaesup('cart', { items: [{ price: 100 }] }, { flushMode: 'manual' });
    await state.$ready;

    await tx(state, (draft) => {
      draft.items[0].price = 120;
      draft.items.push({ price: 300 });
    });

    expect(calls.dispatches).toHaveLength(1);
    expect(calls.dispatches[0].actionType).toBe('BATCH');
    expect(calls.stores.get('cart').items[0].price).toBe(120);
    expect(calls.stores.get('cart').items[1].price).toBe(300);
  });

  it('supports primitive atom set and value assignment', async () => {
    const count = atom(0, 'count');
    await count.$ready;

    count.value = 1;
    await Promise.resolve();
    await count.set((value) => value + 1);

    expect(count.get()).toBe(2);
    expect(calls.stores.get('count').value).toBe(2);
  });
});

describe('dependency-tracked watch', () => {
  beforeEach(() => {
    calls.stores.clear();
    calls.dispatches.length = 0;
  });

  it('reruns only when a selected dependency changes', async () => {
    const state = gaesup('watch-profile', { user: { name: 'Ada' }, count: 0 }, { flushMode: 'manual' });
    await state.$ready;
    const values: string[] = [];

    const stop = watch(state, (draft) => draft.user.name, (value) => values.push(value));
    state.count += 1;
    state.user.name = 'Grace';
    stop();
    state.user.name = 'Hidden';

    expect(values).toEqual(['Ada', 'Grace']);
  });

  it('re-collects dependencies when the selector branch changes', async () => {
    const state = gaesup(
      'watch-branch',
      { mode: 'user' as 'user' | 'guest', user: { name: 'Ada' }, guest: { name: 'Visitor' } },
      { flushMode: 'manual' }
    );
    await state.$ready;
    const values: string[] = [];

    watch(state, (draft) => (draft.mode === 'user' ? draft.user.name : draft.guest.name), (value) => values.push(value));
    state.guest.name = 'Ignored';
    state.mode = 'guest';
    state.user.name = 'Ignored too';
    state.guest.name = 'Shown';

    expect(values).toEqual(['Ada', 'Ignored', 'Shown']);
  });
});

describe('resource query API', () => {
  beforeEach(() => {
    calls.stores.clear();
    calls.dispatches.length = 0;
  });

  it('fetches data into a store without React Query', async () => {
    const fetcher = vi.fn(async () => [{ id: 1, title: 'first' }]);
    const todos = resource('todos', fetcher, { enabled: false });
    await todos.$ready;

    await todos.refetch();

    expect(fetcher).toHaveBeenCalledOnce();
    expect(todos.status).toBe('success');
    expect(todos.data).toEqual([{ id: 1, title: 'first' }]);
    expect(todos.isFetching).toBe(false);
    expect(calls.stores.get('resource:todos').data).toEqual([{ id: 1, title: 'first' }]);
  });

  it('supports optimistic mutate and invalidate', async () => {
    const todos = resource<{ id: number; done: boolean }[]>('todos-mutating', async () => [], {
      enabled: false,
      initialData: [{ id: 1, done: false }]
    });
    await todos.$ready;

    await todos.mutate((previous) => previous!.map((todo) => ({ ...todo, done: true })));
    await todos.invalidate();

    expect(todos.data).toEqual([{ id: 1, done: true }]);
    expect(todos.isStale).toBe(true);
  });

  it('keeps fresh data inside staleTime', async () => {
    const fetcher = vi.fn(async () => 'server');
    const profile = resource('profile-query', fetcher, {
      enabled: false,
      initialData: 'cached',
      staleTime: 60_000
    });
    await profile.$ready;

    const value = await profile.refetch();

    expect(value).toBe('cached');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('stores query errors in resource state', async () => {
    const error = new Error('nope');
    const profile = resource('profile-error', async () => {
      throw error;
    }, { enabled: false });
    await profile.$ready;

    await expect(profile.refetch()).rejects.toThrow('nope');

    expect(profile.status).toBe('error');
    expect(profile.error).toBe(error);
    expect(profile.isFetching).toBe(false);
  });
});

describe('dispatch pipeline', () => {
  beforeEach(() => {
    calls.stores.clear();
    calls.dispatches.length = 0;
  });

  it('flushes multiple updates as one batch dispatch', async () => {
    await GaesupCore.createStore('pipeline', { count: 0, user: { name: 'Ada' } });
    const pipeline = GaesupCore.createPipeline('pipeline', { autoFlush: false });

    pipeline.update('count', 1);
    pipeline.update('user.name', 'Grace');
    await pipeline.flush();

    expect(calls.dispatches).toEqual([
      {
        storeId: 'pipeline',
        actionType: 'BATCH',
        payload: [
          { actionType: 'UPDATE', payload: { path: 'count', value: 1 } },
          { actionType: 'UPDATE', payload: { path: 'user.name', value: 'Grace' } }
        ]
      }
    ]);
    expect(calls.stores.get('pipeline')).toEqual({ count: 1, user: { name: 'Grace' } });
  });

  it('keeps only the latest same-path mutation in a pipeline', async () => {
    await GaesupCore.createStore('pipeline-latest', { count: 0 });
    const pipeline = GaesupCore.pipeline('pipeline-latest', { autoFlush: false });

    pipeline.update('count', 1);
    pipeline.update('count', 2);
    await pipeline.flush();

    expect(calls.dispatches).toEqual([
      { storeId: 'pipeline-latest', actionType: 'UPDATE', payload: { path: 'count', value: 2 } }
    ]);
    expect(calls.stores.get('pipeline-latest').count).toBe(2);
  });

  it('auto flushes a pipeline in a microtask', async () => {
    await GaesupCore.createStore('pipeline-auto', { count: 0 });
    const pipeline = GaesupCore.pipeline('pipeline-auto');

    pipeline.update('count', 1);
    pipeline.update('count', 2);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(calls.dispatches).toEqual([
      { storeId: 'pipeline-auto', actionType: 'UPDATE', payload: { path: 'count', value: 2 } }
    ]);
  });
});

function flattenMutations(dispatches: Array<{ storeId: string; actionType: string; payload: any }>) {
  return dispatches.flatMap((dispatch) => {
    if (dispatch.actionType !== 'BATCH') return [dispatch];
    return dispatch.payload.map((mutation: any) => ({
      storeId: dispatch.storeId,
      actionType: mutation.actionType,
      payload: mutation.payload
    }));
  });
}

function setPath(target: any, path: string, value: any) {
  const parts = path.split('.').filter(Boolean);
  let current = target;
  for (const part of parts.slice(0, -1)) {
    current[part] ??= {};
    current = current[part];
  }
  current[parts[parts.length - 1]] = structuredClone(value);
}

function deletePath(target: any, path: string) {
  const parts = path.split('.').filter(Boolean);
  let current = target;
  for (const part of parts.slice(0, -1)) {
    current = current?.[part];
    if (!current) return;
  }
  delete current[parts[parts.length - 1]];
}

function getPath(target: any, path: string) {
  return path.split('.').filter(Boolean).reduce((current, part) => current?.[part], target);
}
