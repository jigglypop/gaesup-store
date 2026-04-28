# Quick Start

This guide gets the workspace installed, builds the packages, runs the demo, and shows the store and container APIs that matter first.

## Requirements

- Node.js 18 or newer.
- pnpm 8 or newer.
- Rust and `wasm-pack` are only required when rebuilding the Rust/WASM package. The repository includes JavaScript fallback files for development.

Enable pnpm through Corepack:

```bash
corepack enable
corepack prepare pnpm@8.10.0 --activate
pnpm install
```

## Build

Build all package libraries:

```bash
pnpm -r --filter "./packages/**" run build
```

Build the container builder:

```bash
pnpm --filter @gaesup-state/container-builder run build
```

Run the core test suite:

```bash
pnpm --filter @gaesup-state/core exec vitest run src/__tests__/core.test.ts
```

## Run the Demo

```bash
pnpm --filter @gaesup-state/multi-framework-demo run dev -- --host 0.0.0.0
```

Open:

```text
http://localhost:3000/
```

The demo shows four counters: React, Vue, Svelte, and Angular-like. They all subscribe to the same `multi-framework-demo` store. Pressing any framework's button updates all four counters.

## Create a Store

```typescript
import { GaesupCore } from '@gaesup-state/core';

await GaesupCore.createStore('app', { count: 0 }, {
  schema: {
    storeId: 'app',
    schemaId: 'counter-state',
    schemaVersion: '1.0.0'
  }
});
```

Read state:

```typescript
const state = GaesupCore.select('app', '');
const count = GaesupCore.select('app', 'count');
```

Update state:

```typescript
await GaesupCore.dispatch('app', 'MERGE', { count: count + 1 });
await GaesupCore.dispatch('app', 'UPDATE', { path: 'count', value: 10 });
await GaesupCore.dispatch('app', 'SET', { count: 0 });
```

Subscribe:

```typescript
const callbackId = 'app-listener';

GaesupCore.registerCallback(callbackId, () => {
  console.log(GaesupCore.select('app', ''));
});

const subscriptionId = GaesupCore.subscribe('app', '', callbackId);

GaesupCore.unsubscribe(subscriptionId);
GaesupCore.unregisterCallback(callbackId);
```

## Run a Container with a Manifest

```typescript
import { ContainerManager } from '@gaesup-state/core';

const manager = new ContainerManager({
  defaultRuntime: 'browser',
  compatibility: {
    hostVersion: '0.2.0',
    abiVersion: '1.0',
    dependencies: [
      { name: 'lodash', version: '4.17.21' }
    ],
    stores: [
      {
        storeId: 'app',
        schemaId: 'counter-state',
        schemaVersion: '1.0.0'
      }
    ]
  }
});

const container = await manager.run('counter:1.0.0', {
  runtime: 'browser',
  manifest: {
    manifestVersion: '1.0',
    name: 'counter',
    version: '1.0.0',
    gaesup: { abiVersion: '1.0' },
    dependencies: [
      { name: 'lodash', version: '^4.17.0' }
    ],
    stores: [
      {
        storeId: 'app',
        schemaId: 'counter-state',
        schemaVersion: '^1.0.0',
        compatRange: '^1.0.0',
        conflictPolicy: 'reject'
      }
    ],
    allowedImports: ['env.memory'],
    permissions: {
      network: false,
      storage: 'scoped'
    }
  }
});
```

If the dependency range, ABI, or store schema is incompatible, `ContainerManager.run()` rejects before instantiating the WASM module.

## Framework Usage

React:

```tsx
import { useGaesupState } from '@gaesup-state/react';

function Counter() {
  const [state] = useGaesupState<{ count: number }>('app');

  return (
    <button onClick={() => GaesupCore.dispatch('app', 'MERGE', { count: state.count + 1 })}>
      {state.count}
    </button>
  );
}
```

Vue:

```typescript
import { useGaesupState } from '@gaesup-state/vue';

const { state } = useGaesupState<{ count: number }>('app', { count: 0 });
```

Svelte:

```svelte
<script lang="ts">
  import { gaesupStore } from '@gaesup-state/svelte';

  const store = gaesupStore('app', { count: 0 });
</script>

<button on:click={() => store.update((state) => ({ count: state.count + 1 }))}>
  {$store.count}
</button>
```

## Containerfile Directives

The builder supports package metadata directives:

```dockerfile
FROM scratch
ABI 1.0
DEPENDENCY lodash ^4.17.0
STORE app counter-state ^1.0.0 reject
IMPORT env.memory
```

These are emitted into the container manifest and validated by the host before execution.

## Troubleshooting

### React, Vue, or Svelte does not update

Check that the store exists before the component mounts, and check that the callback is registered before `GaesupCore.subscribe()` is called.

### Type declarations are missing

Run a package build. Packages emit declarations after Vite builds:

```bash
pnpm -r --filter "./packages/**" run build
```

### Vite cannot resolve package source

Framework packages should consume `@gaesup-state/core` through built declarations, not direct source references. The package tsconfig files already override paths for this.
