# gaesup-state

[![npm version](https://img.shields.io/npm/v/gaesup-state?color=0f766e)](https://www.npmjs.com/package/gaesup-state)
[![npm downloads](https://img.shields.io/npm/dm/gaesup-state?color=2563eb)](https://www.npmjs.com/package/gaesup-state)
[![license](https://img.shields.io/npm/l/gaesup-state)](../../LICENSE)
[![types](https://img.shields.io/npm/types/gaesup-state?color=334155)](https://www.npmjs.com/package/gaesup-state)
[![wasm runtime](https://img.shields.io/badge/runtime-Rust%2FWASM-b7410e)](https://www.npmjs.com/package/gaesup-state-core-rust)

TypeScript API for Gaesup-State.

Gaesup-State is a Rust/WASM state runtime for frontend apps that need shared state, dependency isolation, store schema contracts, resource/query state, dispatch pipelines, and render-state fast paths.

## Install

```bash
npm install gaesup-state gaesup-state-core-rust
```

```bash
pnpm add gaesup-state gaesup-state-core-rust
```

## Quick Start

```typescript
import { gaesup } from 'gaesup-state';

const counter = gaesup({
  count: 0,
  user: { name: 'Ada' }
});

await counter.$ready;

counter.count += 1;
counter.user.name = 'Grace';
```

`gaesup` tracks object mutations through a proxy and sends path patches to the Rust/WASM store.

## Reactive Graph

`state` and `derived` form a dependency graph with automatic tracking. Only the affected subgraph recomputes, and subscribers are notified once per change (glitch-free through diamonds).

```typescript
import { state, derived, batch } from 'gaesup-state';

const count = state(1);
const doubled = derived(() => count.get() * 2);

doubled.subscribe((value) => console.log(value));

batch(() => {
  count.set(2);
  count.set(3);
}); // one notification: 6
```

Dependency cycles fail closed with a `DependencyCycleError` (`GAESUP_DEPENDENCY_CYCLE`) that includes the cycle path.

`graphResource` puts server/IO state on the same graph. Any state read inside `key()` is tracked automatically — when it changes, the resource refetches without effects or manual invalidation, and stale responses never overwrite newer ones.

```typescript
import { state, derived, graphResource } from 'gaesup-state';

const userId = state(1);

const user = graphResource({
  key: () => ['user', userId.get()],
  fetch: async ([, id]) => (await fetch(`/api/users/${id}`)).json()
});

const userName = derived(() => user.get().data?.name ?? 'anonymous');

userId.set(2); // key changed -> automatic refetch -> userName recomputes
```

Resources cache per key: a fresh hit (within `staleTime`) serves the cache without fetching, a stale hit serves cached data (status `stale`) while revalidating, concurrent same-key fetches are deduplicated, and `invalidate()` is the explicit escape hatch. State persists through adapters — `state(0, { persist: webStoragePersistence('count', localStorage) })` loads on creation and saves committed changes only (rollbacks never persist).

`createGraphMesh` wires containers together without shared imports. A container exposes an explicit interface into a namespace; consumers resolve it by address and receive read-only facades — external code can read and subscribe but never mutate.

```typescript
import { createGraphMesh, state } from 'gaesup-state';

const mesh = createGraphMesh();
mesh.expose('auth', { user: state(null), logout: () => {} });

const user = mesh.consume('auth.user'); // read-only: get/subscribe, no set
const optional = mesh.consume('reco.data', { required: false }); // undefined if absent
```

Missing required dependencies fail closed with `GAESUP_DEPENDENCY_UNAVAILABLE`; duplicate exposure with `GAESUP_EXPOSE_CONFLICT`. `mesh.dependencies()` returns the recorded consumer edges for introspection.

`defineContainer` / `createRuntime` manage containers on top of the mesh: a lifecycle state machine (CREATED → RESOLVING → READY → STARTING → ACTIVE → SUSPENDED/STOPPED → DESTROYED, undefined transitions rejected with `GAESUP_INVALID_TRANSITION`), topological startup of declared dependencies, per-container failure isolation (a setup crash marks only that container FAILED and reports through `onContainerError`), and `health()` (healthy / degraded / failed).

```typescript
import { createRuntime, defineContainer, state } from 'gaesup-state';

const runtime = createRuntime({ env: { API_URL: '...' } });
runtime.register(defineContainer({
  name: 'auth',
  setup: () => {
    const user = state(null);
    return { exposes: { user } };
  }
}));
runtime.register(defineContainer({
  name: 'portfolio',
  dependencies: ['auth'],
  setup: ({ consume }) => ({ user: consume('auth.user') })
}));
runtime.startAll(); // auth first, then portfolio
```

`transaction` groups writes atomically — observers never see intermediate state, and a throw reverts every write. `command` layers the mutation pipeline on top: optimistic transition, execute, then commit on success or automatic rollback on failure.

```typescript
import { state, transaction, command } from 'gaesup-state';

const name = state('old');

transaction(() => {
  // multiple writes commit together; a throw rolls all of them back
});

const rename = command({
  optimistic: (next: string) => name.set(next), // visible immediately
  execute: async (next) => api.rename(next),
  commit: (result) => name.set(result) // or automatic rollback on rejection
});
```

`graphStream` brings realtime sources (WebSocket, SSE, BroadcastChannel) into the same graph. Pushed values land in graph state, so derived nodes downstream react per event; source errors surface as status `error` with teardown, and late events after disconnect are dropped.

```typescript
import { derived, graphStream } from 'gaesup-state';

const price = graphStream<number>({
  subscribe: (observer) => socket.subscribe(observer) // returns teardown
});

const doubled = derived(() => (price.get() ?? 0) * 2); // recomputes per event
price.disconnect(); // pause; connect() resumes
```

## Resource / Query

Use `resource` when API state should live with the same store model.

```typescript
import { resource } from 'gaesup-state';

const todos = resource('todos', async () => {
  const response = await fetch('/api/todos');
  return response.json() as Promise<Array<{ id: number; title: string }>>;
});

await todos.refetch();

console.log(todos.status);
console.log(todos.data);
```

`query` is an alias for `resource`.

## Dispatch Pipeline

Use a pipeline when several updates should cross the JS/WASM boundary once.

```typescript
import { GaesupCore } from 'gaesup-state';

const pipe = GaesupCore.pipeline('editor', {
  autoFlush: false
});

pipe.update('document.title', 'New title');
pipe.update('selection.active', true);
pipe.delete('draft.error');

await pipe.flush();
```

## Deployment Guard

Use deployment contracts when several WASM containers are deployed as page slots and must not drift apart.

```typescript
import { CompatibilityGuard } from 'gaesup-state';

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
      { slot: 'header', slotVersion: '^1.4.0', contractVersion: '^1.1.0' }
    ]
  }
});
```

If a body container expects a newer header contract, validation fails before the shared store is connected.

## Low-Level Store API

```typescript
import { GaesupCore } from 'gaesup-state';

await GaesupCore.createStore('orders', { count: 0 });
await GaesupCore.dispatch('orders', 'MERGE', { count: 1 });

const count = GaesupCore.select('orders', 'count');
```

## Main APIs

| API | Use for |
| --- | --- |
| `gaesup` | Minimal object-style state |
| `$store` | Alias for `gaesup` |
| `atom` | One primitive or small value |
| `state` / `derived` / `batch` | Reactive dependency graph |
| `graphResource` | Server state as a graph node (auto refetch on key change) |
| `createGraphMesh` | Expose/consume contracts between containers |
| `transaction` / `command` | Atomic writes, optimistic updates with rollback |
| `graphStream` | Realtime sources as graph nodes |
| `defineContainer` / `createRuntime` | Container lifecycle, startup ordering, health |
| `watch` | Selector-based dependency tracking |
| `resource` / `query` | API request state |
| `GaesupCore.pipeline` | Batching several dispatches |
| `GaesupCore` | Low-level store, snapshot, metrics, compatibility |
| `CompatibilityGuard` | WASM package manifest validation |
| `GaesupRender` | Render-state fast path |

## Documentation

See the repository docs:

- Auto store: `docs/auto-store.md`
- Resource/query: `docs/resource-query.md`
- Dispatch pipeline: `docs/pipeline.md`
- Deployment guard: `docs/deployment-guard.md`
- Performance notes: `docs/performance.md`
- Render runtime: `docs/render-runtime.md`

## Runtime Notes

`gaesup-state` imports the browser/web WASM entry from `gaesup-state-core-rust/web`. Make sure your bundler supports WASM assets. Vite and modern bundlers generally work once the WASM package is included in the dependency graph.

For Node benchmarks or server-side tooling, import the Rust package entry directly from `gaesup-state-core-rust/node`.
