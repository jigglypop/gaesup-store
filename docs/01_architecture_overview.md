# Architecture Overview

Gaesup-State has three runtime layers.

## 1. Store Boundary

`GaesupCore` owns named stores. A store is addressed by `storeId`, can expose schema metadata, and emits updates through callback subscriptions.

Primary operations:

- `createStore(storeId, initialState, options)`
- `dispatch(storeId, actionType, payload)`
- `select(storeId, path)`
- `subscribe(storeId, path, callbackId)`
- `registerStoreSchema(schema)`
- `getStoreSchemas()`

The store boundary is intentionally explicit. Framework adapters do not own separate state; they subscribe to the same store and render snapshots.

## 2. Container Boundary

`ContainerManager` loads WASM containers. Before it instantiates a module, it resolves and validates a `ContainerPackageManifest`.

The manager validates:

- ABI version.
- Host package dependencies.
- Store schema dependencies.
- Allowed imports.
- Permission metadata.
- Conflict policy.

## 3. Framework Boundary

React, Vue, Svelte, and Angular packages provide adapter APIs over the store and container boundary. They should not bypass the core package by importing source files directly. Package builds emit declarations into `dist`, and framework tsconfig files resolve core through those declarations.

## Data Flow

```text
User interaction
  -> Framework adapter
  -> GaesupCore.dispatch()
  -> Store update
  -> Subscriptions notify callbacks
  -> React/Vue/Svelte/Angular render the same snapshot
```

For WASM packages:

```text
ContainerManager.run()
  -> Resolve manifest
  -> CompatibilityGuard.validate()
  -> Apply manifest defaults
  -> Instantiate WASM runtime
  -> Register container instance
```

## Design Rule

State must not be inferred from dependency containers. A container declares the store schemas it needs; the host validates those declarations; only then can the container run.
