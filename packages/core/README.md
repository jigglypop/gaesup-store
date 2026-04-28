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
- Performance notes: `docs/performance.md`
- Render runtime: `docs/render-runtime.md`

## Runtime Notes

`gaesup-state` imports the browser/web WASM entry from `gaesup-state-core-rust/web`. Make sure your bundler supports WASM assets. Vite and modern bundlers generally work once the WASM package is included in the dependency graph.

For Node benchmarks or server-side tooling, import the Rust package entry directly from `gaesup-state-core-rust/node`.
