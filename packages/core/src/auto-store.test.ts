import { beforeEach, describe, expect, it, vi } from 'vitest';

const calls = vi.hoisted(() => ({
  stores: new Map<string, any>(),
  machines: new Map<string, any>(),
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
  dispatch_with_metadata: vi.fn((storeId: string, actionType: string, payload: any) => {
    const dispatchMock = calls.dispatches;
    const beforeLength = dispatchMock.length;
    const current = calls.stores.get(storeId) || {};
    calls.dispatches.push({ storeId, actionType, payload: structuredClone(payload) });
    if (actionType === 'UPDATE') setPath(current, payload.path, payload.value);
    if (actionType === 'SET') calls.stores.set(storeId, structuredClone(payload));
    if (actionType === 'MERGE') Object.assign(current, payload);
    const next = calls.stores.get(storeId) || current;
    return {
      state: next,
      changedPaths: beforeLength === calls.dispatches.length ? [] : changedPathsMock(actionType, payload)
    };
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
  create_container: vi.fn((config: any) => ({
    id: config.id || `${config.name}:test`,
    name: config.name,
    status: 'running',
    state: structuredClone(config.initialState || {}),
    calls: 0
  })),
  call_container: vi.fn(),
  get_container_state: vi.fn(() => ({})),
  get_container_metrics: vi.fn(() => ({ status: 'running' })),
  stop_container: vi.fn(),
  list_containers: vi.fn(() => []),
  validate_manifest: vi.fn((manifest: any, host: any) => validateManifestMock(manifest, host)),
  create_machine: vi.fn((definition: any) => {
    const id = definition.id;
    calls.machines.set(id, {
      id,
      definition: structuredClone(definition),
      state: definition.initial,
      context: structuredClone(definition.context || {}),
      status: definition.states?.[definition.initial]?.final ? 'final' : 'active',
      step: 0,
      history: [],
      checkpoints: []
    });
    return id;
  }),
  start_machine: vi.fn((machineId: string, context: any) => {
    const machine = calls.machines.get(machineId);
    if (context) machine.context = structuredClone(context);
    return machineSnapshotMock(machine, false, []);
  }),
  send_machine: vi.fn((machineId: string, event: any) => {
    const machine = calls.machines.get(machineId);
    const node = machine.definition.states[machine.state];
    const transition = node.on?.[event.type];
    if (!transition) return machineResultMock(false, machine, 'TRANSITION_NOT_FOUND', []);
    if (transition.guard && !event.__guards?.[transition.guard]) {
      return machineResultMock(false, machine, 'GUARD_REJECTED', []);
    }

    machine.checkpoints.push(structuredClone({
      state: machine.state,
      context: machine.context,
      status: machine.status,
      step: machine.step,
      history: machine.history
    }));

    const target = transition.target || machine.state;
    if (transition.assign) {
      for (const [path, expression] of Object.entries(transition.assign)) {
        setPath(machine.context, path, resolveMachineExpressionMock(expression, machine.context, event));
      }
    }
    const effects = transition.action ? [machineEffectMock(transition.action, event)] : [];
    machine.history.push({ from: machine.state, to: target, event: event.type, timestamp: Date.now(), durationMs: 0 });
    machine.state = target;
    machine.step += 1;
    machine.status = machine.definition.states[target]?.final ? 'final' : 'active';
    return machineResultMock(true, machine, '', effects);
  }),
  rollback_machine: vi.fn((machineId: string, steps = 1) => {
    const machine = calls.machines.get(machineId);
    let checkpoint: any;
    for (let index = 0; index < Math.max(1, steps); index += 1) {
      checkpoint = machine.checkpoints.pop();
    }
    if (!checkpoint) return machineResultMock(false, machine, 'ROLLBACK_CHECKPOINT_NOT_FOUND', []);
    Object.assign(machine, structuredClone(checkpoint));
    return machineResultMock(true, machine, '', []);
  }),
  cleanup_machine: vi.fn((machineId: string) => {
    calls.machines.delete(machineId);
  }),
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

import { atom, CompatibilityGuard, ContainerManager, DemoContainerManager, createActor, createAutoStore, createMachine, createOptimalContainerManager, GaesupCore, gaesup, initGaesupCore, resource, tx, watch } from './index';

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

describe('store runtime policies', () => {
  beforeEach(() => {
    calls.stores.clear();
    calls.dispatches.length = 0;
    GaesupCore.clearStoreRuntimePolicy('orders');
    GaesupCore.clearStoreRuntimePolicy('orders-v2');
    GaesupCore.clearStoreRuntimePolicy('orders-shadow');
    GaesupCore.clearStoreRuntimePolicy('orders-migrating');
    GaesupCore.clearStoreRuntimePolicy('orders-migrate-runner');
    GaesupCore.clearStoreRuntimePolicy('orders-migrate-failed');
    GaesupCore.clearStoreRuntimePolicy('orders-readonly-auto');
    GaesupCore.clearStoreRuntimePolicy('orders-shadow-auto');
    GaesupCore.clearStoreRuntimePolicy('orders-migrate-auto');
    GaesupCore.clearStoreRuntimePolicy('orders-dual-auto');
  });

  it('rejects writes for readonly stores', async () => {
    await GaesupCore.createStore('orders', { count: 1 });
    GaesupCore.setStoreRuntimePolicy({ storeId: 'orders', policy: 'readonly' });

    await expect(GaesupCore.dispatch('orders', 'UPDATE', { path: 'count', value: 2 })).rejects.toThrow('readonly');
    expect(calls.dispatches).toEqual([]);
  });

  it('routes shadow policy reads and writes to the shadow store', async () => {
    await GaesupCore.createStore('orders', { count: 1 });
    await GaesupCore.createStore('orders-shadow', { count: 10 });
    GaesupCore.setStoreRuntimePolicy({
      storeId: 'orders',
      policy: 'shadow',
      shadowStoreId: 'orders-shadow'
    });

    await GaesupCore.dispatch('orders', 'UPDATE', { path: 'count', value: 11 });

    expect(calls.stores.get('orders').count).toBe(1);
    expect(calls.stores.get('orders-shadow').count).toBe(11);
    expect(GaesupCore.select('orders', 'count')).toBe(11);
  });

  it('duplicates writes for dual-write stores', async () => {
    await GaesupCore.createStore('orders', { count: 1 });
    await GaesupCore.createStore('orders-v2', { count: 100 });
    GaesupCore.setStoreRuntimePolicy({
      storeId: 'orders',
      policy: 'dual-write',
      dualWriteStoreIds: ['orders-v2']
    });

    await GaesupCore.dispatch('orders', 'UPDATE', { path: 'count', value: 2 });

    expect(calls.stores.get('orders').count).toBe(2);
    expect(calls.stores.get('orders-v2').count).toBe(2);
    expect(calls.dispatches.map((item) => item.storeId)).toEqual(['orders', 'orders-v2']);
  });

  it('blocks shared store reads and writes until migrate policy is completed', async () => {
    await GaesupCore.createStore('orders-migrating', { count: 1 });
    GaesupCore.setStoreRuntimePolicy({
      storeId: 'orders-migrating',
      policy: 'migrate'
    });

    expect(() => GaesupCore.select('orders-migrating', 'count')).toThrow('requires migration');
    await expect(GaesupCore.dispatch('orders-migrating', 'UPDATE', {
      path: 'count',
      value: 2
    })).rejects.toThrow('requires migration');
    expect(calls.dispatches).toEqual([]);
    expect(GaesupCore.getRuntimeTimeline().some((event) => (
      event.type === 'runtime:error' &&
      event.code === 'STORE_MIGRATION_REQUIRED' &&
      event.storeId === 'orders-migrating'
    ))).toBe(true);

    GaesupCore.completeStoreMigration('orders-migrating');
    await GaesupCore.dispatch('orders-migrating', 'UPDATE', {
      path: 'count',
      value: 2
    });

    expect(GaesupCore.select('orders-migrating', 'count')).toBe(2);
  });

  it('runs a migration and opens shared store access only after it succeeds', async () => {
    await GaesupCore.createStore('orders-migrate-runner', {
      version: 1,
      total: 10
    });
    GaesupCore.setStoreRuntimePolicy({
      storeId: 'orders-migrate-runner',
      policy: 'migrate'
    });

    const migrated = await GaesupCore.migrateStore<{ version: number; total: number; currency?: string }>(
      'orders-migrate-runner',
      (state) => ({
        ...state,
        version: 2,
        currency: 'USD'
      })
    );

    expect(migrated).toEqual({
      version: 2,
      total: 10,
      currency: 'USD'
    });
    expect(GaesupCore.select('orders-migrate-runner', 'currency')).toBe('USD');
    expect(calls.dispatches).toEqual([
      {
        storeId: 'orders-migrate-runner',
        actionType: 'SET',
        payload: {
          version: 2,
          total: 10,
          currency: 'USD'
        }
      }
    ]);
  });

  it('keeps migrate stores blocked when the migration fails', async () => {
    await GaesupCore.createStore('orders-migrate-failed', { version: 1 });
    GaesupCore.setStoreRuntimePolicy({
      storeId: 'orders-migrate-failed',
      policy: 'migrate'
    });

    await expect(GaesupCore.migrateStore('orders-migrate-failed', () => {
      throw new Error('bad migration');
    })).rejects.toThrow('bad migration');

    expect(calls.dispatches).toEqual([]);
    expect(() => GaesupCore.select('orders-migrate-failed', 'version')).toThrow('requires migration');
    expect(GaesupCore.getRuntimeTimeline().some((event) => (
      event.type === 'runtime:error' &&
      event.code === 'STORE_MIGRATION_FAILED' &&
      event.storeId === 'orders-migrate-failed'
    ))).toBe(true);
  });

  it('applies manifest validation store policy warnings to runtime enforcement', async () => {
    await GaesupCore.createStore('orders-readonly-auto', { count: 1 });
    await GaesupCore.createStore('orders-shadow-auto', { count: 1 });
    await GaesupCore.createStore('orders-shadow-auto:shadow', { count: 10 });
    await GaesupCore.createStore('orders-migrate-auto', { count: 1 });

    GaesupCore.applyManifestStorePolicies({
      manifestVersion: '1.0',
      name: 'policy-widget',
      version: '1.0.0',
      stores: [
        {
          storeId: 'orders-readonly-auto',
          schemaId: 'orders',
          schemaVersion: '^2.0.0',
          conflictPolicy: 'readonly'
        },
        {
          storeId: 'orders-shadow-auto',
          schemaId: 'orders',
          schemaVersion: '^2.0.0',
          conflictPolicy: 'shadow',
          shadowStoreId: 'orders-shadow-auto:shadow'
        },
        {
          storeId: 'orders-migrate-auto',
          schemaId: 'orders',
          schemaVersion: '^2.0.0',
          conflictPolicy: 'migrate'
        }
      ]
    }, {
      valid: true,
      errors: [],
      isolatedStores: ['orders-shadow-auto'],
      warnings: [
        { code: 'STORE_SCHEMA_READONLY', message: 'readonly', severity: 'warning', target: 'orders-readonly-auto' },
        { code: 'STORE_SCHEMA_SHADOWED', message: 'shadow', severity: 'warning', target: 'orders-shadow-auto' },
        { code: 'STORE_SCHEMA_MIGRATION_REQUIRED', message: 'migrate', severity: 'warning', target: 'orders-migrate-auto' }
      ]
    });

    await expect(GaesupCore.dispatch('orders-readonly-auto', 'UPDATE', {
      path: 'count',
      value: 2
    })).rejects.toThrow('readonly');

    await GaesupCore.dispatch('orders-shadow-auto', 'UPDATE', {
      path: 'count',
      value: 11
    });
    expect(calls.stores.get('orders-shadow-auto').count).toBe(1);
    expect(calls.stores.get('orders-shadow-auto:shadow').count).toBe(11);

    expect(() => GaesupCore.select('orders-migrate-auto', 'count')).toThrow('requires migration');
  });

  it('fails closed when dual-write validation lacks runtime target stores', () => {
    expect(() => GaesupCore.applyManifestStorePolicies({
      manifestVersion: '1.0',
      name: 'dual-widget',
      version: '1.0.0',
      stores: [
        {
          storeId: 'orders-dual-auto',
          schemaId: 'orders',
          schemaVersion: '^2.0.0',
          conflictPolicy: 'dual-write'
        }
      ]
    }, {
      valid: true,
      errors: [],
      isolatedStores: [],
      warnings: [
        { code: 'STORE_SCHEMA_DUAL_WRITE', message: 'dual', severity: 'warning', target: 'orders-dual-auto' }
      ]
    })).toThrow('dual-write policy requires runtime dualWriteStoreIds');

    expect(GaesupCore.getRuntimeTimeline().some((event) => (
      event.type === 'runtime:error' &&
      event.code === 'STORE_DUAL_WRITE_TARGETS_MISSING' &&
      event.storeId === 'orders-dual-auto'
    ))).toBe(true);
  });
});

describe('container runtime boundary', () => {
  it('blocks direct WASM container attachment through ContainerManager', async () => {
    const manager = new ContainerManager();

    await expect(manager.createContainer({
      name: 'orders-widget',
      runtime: 'wasm'
    })).rejects.toMatchObject({
      code: 'CONTAINER_RUNTIME_REQUIRES_SANDBOX'
    });

    expect(GaesupCore.getRuntimeTimeline().some((event) => (
      event.type === 'runtime:error' &&
      event.code === 'CONTAINER_RUNTIME_REQUIRES_SANDBOX' &&
      event.details?.runtime === 'wasm'
    ))).toBe(true);
  });

  it('allows explicit demo containers through ContainerManager', async () => {
    const manager = new ContainerManager();
    const container = await manager.createContainer({
      name: 'demo-counter',
      runtime: 'demo',
      initialState: { count: 0 }
    });

    expect(container.getId()).toBe('demo-counter:test');
  });

  it('returns the demo lifecycle manager from createOptimalContainerManager', async () => {
    const manager = await createOptimalContainerManager();

    expect(manager).toBeInstanceOf(DemoContainerManager);
  });
});

describe('machine actor API', () => {
  beforeEach(() => {
    calls.stores.clear();
    calls.machines.clear();
    calls.dispatches.length = 0;
  });

  it('runs guarded step transitions and persists the snapshot into a store', async () => {
    const machine = createMachine({
      id: 'checkout-flow',
      initial: 'cart',
      context: { items: [{ id: 1 }], paymentId: null as string | null },
      states: {
        cart: {
          on: {
            NEXT: { target: 'payment', guard: 'hasItems' }
          }
        },
        payment: {
          on: {
            PAY: {
              target: 'done',
              action: 'requestPayment',
              assign: { paymentId: '$event.paymentId' }
            }
          }
        },
        done: { final: true }
      }
    });

    const effectCalls: any[] = [];
    const actor = createActor(machine, {
      storeId: 'workflow',
      guards: {
        hasItems: ({ context }) => context.items.length > 0
      },
      effects: {
        requestPayment: async ({ payload }) => {
          effectCalls.push(payload);
          return { ok: true };
        }
      }
    });

    const initial = await actor.start();
    expect(initial.state).toBe('cart');

    const next = await actor.send('NEXT');
    expect(next.accepted).toBe(true);
    expect(next.snapshot.state).toBe('payment');

    const paid = await actor.send({ type: 'PAY', paymentId: 'pay_1', payload: { amount: 3900 } });
    expect(paid.accepted).toBe(true);
    expect(paid.snapshot.state).toBe('done');
    expect(paid.snapshot.context.paymentId).toBe('pay_1');
    expect(paid.effectResults?.[0].status).toBe('resolved');
    expect(effectCalls).toEqual([{ amount: 3900 }]);
    expect(calls.stores.get('workflow').machines['checkout-flow'].state).toBe('done');
  });

  it('rejects a transition when a named guard returns false and supports rollback', async () => {
    const actor = createActor(createMachine({
      id: 'blocked-flow',
      initial: 'draft',
      context: { ready: false },
      states: {
        draft: {
          on: {
            NEXT: { target: 'review', guard: 'isReady' }
          }
        },
        review: {}
      }
    }), {
      guards: {
        isReady: ({ context, event }) => context.ready || event.force === true
      }
    });

    await actor.start();
    const rejected = await actor.send('NEXT');
    expect(rejected.accepted).toBe(false);
    expect(rejected.rejectedReason).toBe('GUARD_REJECTED');

    const accepted = await actor.send({ type: 'NEXT', force: true });
    expect(accepted.snapshot.state).toBe('review');

    const rolledBack = await actor.rollback();
    expect(rolledBack.accepted).toBe(true);
    expect(rolledBack.snapshot.state).toBe('draft');
  });

  it('denies effects that are not allowed and records machine timeline events', async () => {
    const actor = createActor(createMachine({
      id: 'effect-policy-flow',
      initial: 'idle',
      context: {},
      states: {
        idle: {
          on: {
            RUN: { target: 'done', action: 'sendEmail' }
          }
        },
        done: { final: true }
      }
    }), {
      allowedEffects: ['effects:otherEffect'],
      effects: {
        sendEmail: vi.fn()
      }
    });

    await actor.start();
    const result = await actor.send('RUN');
    const timeline = GaesupCore.getRuntimeTimeline();

    expect(result.accepted).toBe(true);
    expect(result.effectResults?.[0]).toMatchObject({
      status: 'denied',
      error: 'Effect permission denied: effects:sendEmail'
    });
    expect(timeline.some((event) => event.type === 'effect:denied' && event.event === 'sendEmail')).toBe(true);
    expect(timeline.some((event) => event.type === 'machine:transitioned' && event.machineId === 'effect-policy-flow')).toBe(true);
  });
});

describe('deployment drift guard', () => {
  beforeEach(() => {
    calls.stores.clear();
    calls.dispatches.length = 0;
  });

  it('accepts a container slot when the release and peer slot contract match', async () => {
    await initGaesupCore();
    const guard = new CompatibilityGuard({
      deployment: {
        releaseId: 'web-2026-04-28.1',
        strictRelease: true,
        slots: [
          {
            slot: 'header',
            packageName: 'shop-header',
            version: '1.4.0',
            releaseId: 'web-2026-04-28.1',
            slotVersion: '1.4.0',
            contractVersion: '1.1.0'
          }
        ]
      }
    });

    const result = guard.validate({
      manifestVersion: '1.0',
      name: 'shop-body',
      version: '1.8.0',
      deployment: {
        slot: 'body',
        releaseId: 'web-2026-04-28.1',
        requires: [
          { slot: 'header', releaseId: 'web-2026-04-28.1', slotVersion: '^1.4.0', contractVersion: '^1.1.0' }
        ]
      }
    });

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('blocks a container slot from a different release line', async () => {
    await initGaesupCore();
    const guard = new CompatibilityGuard({
      deployment: {
        releaseId: 'web-2026-04-28.1',
        strictRelease: true,
        slots: []
      }
    });

    const result = guard.validate({
      manifestVersion: '1.0',
      name: 'shop-body',
      version: '1.8.0',
      deployment: {
        slot: 'body',
        releaseId: 'web-2026-04-27.9'
      }
    });

    expect(result.valid).toBe(false);
    expect(result.errors[0].code).toBe('DEPLOYMENT_RELEASE_MISMATCH');
  });

  it('blocks a body package when its required header contract is not mounted', async () => {
    await initGaesupCore();
    const guard = new CompatibilityGuard({
      deployment: {
        releaseId: 'web-2026-04-28.1',
        slots: [
          {
            slot: 'header',
            packageName: 'shop-header',
            releaseId: 'web-2026-04-28.1',
            slotVersion: '1.4.0',
            contractVersion: '1.1.0'
          }
        ]
      }
    });

    const result = guard.validate({
      manifestVersion: '1.0',
      name: 'shop-body',
      version: '1.8.0',
      deployment: {
        slot: 'body',
        releaseId: 'web-2026-04-28.1',
        requires: [
          { slot: 'header', slotVersion: '^2.0.0', contractVersion: '^2.0.0' }
        ]
      }
    });

    expect(result.valid).toBe(false);
    expect(result.errors.map((error) => error.code)).toEqual([
      'DEPLOYMENT_SLOT_VERSION_MISMATCH',
      'DEPLOYMENT_SLOT_CONTRACT_MISMATCH'
    ]);
  });
});

describe('manifest integrity guard', () => {
  it('blocks a manifest without an integrity hash when the host requires integrity', async () => {
    await initGaesupCore();
    const guard = new CompatibilityGuard({ requireIntegrity: true });

    const result = guard.validate({
      manifestVersion: '1.0',
      name: 'shop-body',
      version: '1.8.0'
    });

    expect(result.valid).toBe(false);
    expect(result.errors[0].code).toBe('MANIFEST_INTEGRITY_MISSING');
    expect(result.errors[0].target).toBe('integrity.hash');
  });

  it('accepts a manifest with a valid sha256 integrity hash', async () => {
    await initGaesupCore();
    const guard = new CompatibilityGuard({ requireIntegrity: true });

    const result = guard.validate({
      manifestVersion: '1.0',
      name: 'shop-body',
      version: '1.8.0',
      integrity: { hash: `sha256-${'a1b2c3d4'.repeat(8)}` }
    });

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('blocks a manifest whose integrity hash has a malformed digest', async () => {
    await initGaesupCore();
    const guard = new CompatibilityGuard({});

    const result = guard.validate({
      manifestVersion: '1.0',
      name: 'shop-body',
      version: '1.8.0',
      integrity: { hash: 'sha256-not-hex' }
    });

    expect(result.valid).toBe(false);
    expect(result.errors[0].code).toBe('MANIFEST_HASH_INVALID');
    expect(result.errors[0].target).toBe('integrity.hash');
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

function changedPathsMock(actionType: string, payload: any) {
  if (actionType === 'UPDATE' || actionType === 'DELETE') return [payload.path];
  if (actionType === 'MERGE') return Object.keys(payload || {});
  return [''];
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

function validateManifestMock(manifest: any, host: any) {
  const errors: any[] = [];
  const warnings: any[] = [];
  const deployment = manifest.deployment;
  const hostDeployment = host.deployment;

  const integrityHash = manifest.integrity?.hash;
  if (integrityHash) {
    if (!integrityHashIsWellFormedMock(integrityHash)) {
      errors.push({
        code: 'MANIFEST_HASH_INVALID',
        message: `Integrity hash ${integrityHash} is not a valid <algo>-<hexdigest> value`,
        severity: 'error',
        target: 'integrity.hash'
      });
    }
  } else if (host.requireIntegrity) {
    errors.push({
      code: 'MANIFEST_INTEGRITY_MISSING',
      message: 'Host requires manifest integrity but no integrity.hash was declared',
      severity: 'error',
      target: 'integrity.hash'
    });
  }

  if (deployment) {
    const strictRelease = hostDeployment?.strictRelease ?? Boolean(hostDeployment?.releaseId);
    if (strictRelease && deployment.releaseId !== hostDeployment?.releaseId) {
      errors.push({
        code: 'DEPLOYMENT_RELEASE_MISMATCH',
        message: `Container release ${deployment.releaseId} does not match host release ${hostDeployment?.releaseId}`,
        severity: 'error',
        target: 'deployment.releaseId'
      });
    }

    for (const requirement of deployment.requires || []) {
      const slot = hostDeployment?.slots?.find((item: any) => item.slot === requirement.slot);
      if (!slot) {
        errors.push({
          code: 'DEPLOYMENT_SLOT_MISSING',
          message: `Required deployment slot ${requirement.slot} is not registered on the host`,
          severity: 'error',
          target: requirement.slot
        });
        continue;
      }
      if (requirement.releaseId && requirement.releaseId !== slot.releaseId) {
        errors.push({
          code: 'DEPLOYMENT_SLOT_RELEASE_MISMATCH',
          message: `Slot ${requirement.slot} release ${slot.releaseId} does not match required release ${requirement.releaseId}`,
          severity: 'error',
          target: requirement.slot
        });
      }
      if (requirement.slotVersion && !versionSatisfiesMock(slot.slotVersion, requirement.slotVersion)) {
        errors.push({
          code: 'DEPLOYMENT_SLOT_VERSION_MISMATCH',
          message: `Slot ${requirement.slot} version ${slot.slotVersion} does not satisfy ${requirement.slotVersion}`,
          severity: 'error',
          target: requirement.slot
        });
      }
      if (requirement.contractVersion && !versionSatisfiesMock(slot.contractVersion, requirement.contractVersion)) {
        errors.push({
          code: 'DEPLOYMENT_SLOT_CONTRACT_MISMATCH',
          message: `Slot ${requirement.slot} contract ${slot.contractVersion} does not satisfy ${requirement.contractVersion}`,
          severity: 'error',
          target: requirement.slot
        });
      }
    }
  }

  return { valid: errors.length === 0, errors, warnings, isolatedStores: [] };
}

function machineSnapshotMock(machine: any, changed: boolean, actions: any[]) {
  return {
    machineId: machine.id,
    state: machine.state,
    context: structuredClone(machine.context),
    status: machine.status,
    step: machine.step,
    history: structuredClone(machine.history),
    changed,
    actions
  };
}

function machineResultMock(accepted: boolean, machine: any, rejectedReason: string, effects: any[]) {
  return {
    accepted,
    snapshot: machineSnapshotMock(machine, accepted, effects),
    rejectedReason: rejectedReason || undefined,
    effects
  };
}

function machineEffectMock(action: any, event: any) {
  const type = Array.isArray(action) ? action[0] : action;
  return {
    id: `effect:${type}`,
    type,
    payload: event.payload ?? event,
    permission: `effects:${type}`
  };
}

function resolveMachineExpressionMock(expression: any, context: any, event: any) {
  if (expression === '$now') return Date.now();
  if (typeof expression === 'string' && expression.startsWith('$event.')) {
    return getPath(event, expression.slice('$event.'.length));
  }
  if (typeof expression === 'string' && expression.startsWith('$context.')) {
    return getPath(context, expression.slice('$context.'.length));
  }
  return structuredClone(expression);
}

function integrityHashIsWellFormedMock(hash: string) {
  const separator = hash.indexOf('-');
  if (separator <= 0) return false;
  const digestLengths: Record<string, number> = { sha256: 64, sha384: 96, sha512: 128 };
  const expectedLength = digestLengths[hash.slice(0, separator)];
  const digest = hash.slice(separator + 1);
  return Boolean(expectedLength) && digest.length === expectedLength && /^[0-9a-fA-F]+$/.test(digest);
}

function versionSatisfiesMock(provided: string | undefined, required: string) {
  if (!provided || !required || required === '*') return true;
  const parse = (value: string) => value.split(/[^\d]+/).filter(Boolean).slice(0, 3).map(Number);
  const left = parse(provided);
  const right = parse(required.replace(/^[~^]/, ''));
  if (required.startsWith('^')) return left[0] === right[0] && compareVersionMock(left, right) >= 0;
  if (required.startsWith('~')) return left[0] === right[0] && left[1] === right[1] && compareVersionMock(left, right) >= 0;
  if (required.startsWith('>=')) return compareVersionMock(left, parse(required.slice(2))) >= 0;
  return compareVersionMock(left, right) === 0;
}

function compareVersionMock(left: number[], right: number[]) {
  for (let index = 0; index < 3; index += 1) {
    const diff = (left[index] || 0) - (right[index] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}
