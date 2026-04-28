# API Reference

This reference covers the APIs that are currently wired in the repository.

## Core Store API

```typescript
import { GaesupCore } from '@gaesup-state/core';
```

### createStore

```typescript
await GaesupCore.createStore(storeId, initialState, options?);
```

Options:

```typescript
{
  schema?: {
    storeId: string;
    schemaId: string;
    schemaVersion: string;
    compatRange?: string;
  }
}
```

### dispatch

```typescript
await GaesupCore.dispatch(storeId, actionType, payload);
```

Built-in action types:

- `SET`
- `MERGE`
- `UPDATE`
- `DELETE`
- `BATCH`

### select

```typescript
const value = GaesupCore.select(storeId, path);
```

Use an empty path to read the full store.

### subscribe

```typescript
GaesupCore.registerCallback(callbackId, callback);
const subscriptionId = GaesupCore.subscribe(storeId, path, callbackId);
GaesupCore.unsubscribe(subscriptionId);
GaesupCore.unregisterCallback(callbackId);
```

Register callbacks before subscribing.

### snapshots

```typescript
const id = await GaesupCore.createSnapshot(storeId);
await GaesupCore.restoreSnapshot(storeId, id);
```

### metrics

```typescript
const metrics = await GaesupCore.getMetrics(storeId);
```

## Store Schema API

```typescript
GaesupCore.registerStoreSchema({
  storeId: 'app',
  schemaId: 'counter-state',
  schemaVersion: '1.0.0'
});

const schemas = GaesupCore.getStoreSchemas();
```

## Container API

```typescript
import { ContainerManager } from '@gaesup-state/core';
```

### Constructor

```typescript
const manager = new ContainerManager({
  registry?: string;
  maxContainers?: number;
  defaultRuntime?: 'browser' | 'nodejs' | 'wasmtime' | 'wasmedge' | 'wasmer';
  cacheSize?: number;
  debugMode?: boolean;
  enableMetrics?: boolean;
  networkTimeout?: number;
  compatibility?: HostCompatibilityConfig;
});
```

### run

```typescript
const instance = await manager.run(name, config);
```

`config.manifest` can provide the package manifest directly.

### list

```typescript
const containers = manager.list();
```

### getMetrics

```typescript
const metrics = manager.getMetrics();
```

### cleanup

```typescript
await manager.cleanup();
```

## Compatibility API

```typescript
import { CompatibilityGuard } from '@gaesup-state/core';
```

```typescript
const guard = new CompatibilityGuard({
  abiVersion: '1.0',
  dependencies: [{ name: 'lodash', version: '4.17.21' }],
  stores: [{ storeId: 'app', schemaId: 'counter-state', schemaVersion: '1.0.0' }]
});

const decision = guard.validate(manifest);
```

`decision.valid` must be true before a container can run.

## Framework APIs

React:

```typescript
import { useGaesupState } from '@gaesup-state/react';
```

Vue:

```typescript
import { useGaesupState } from '@gaesup-state/vue';
```

Svelte:

```typescript
import { gaesupStore } from '@gaesup-state/svelte';
```

Angular:

```typescript
import { ContainerManagerService, ContainerService } from '@gaesup-state/angular';
```
