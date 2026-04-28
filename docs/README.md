# Gaesup-State Documentation

Gaesup-State is a WASM-oriented state and container runtime for frontend applications. It treats a WASM package as a small dependency container, validates its manifest before execution, and keeps shared UI state behind an explicit store contract.

The current repository focuses on three ideas:

- A WASM package should describe its ABI, imports, permissions, package dependencies, and store dependencies before it is loaded.
- Dependency and store conflicts should be rejected before runtime state can drift.
- Framework adapters should subscribe to the same store boundary instead of duplicating state per framework.

## Current Status

The TypeScript packages build as libraries and publish declarations from `dist`.

Verified locally:

```bash
pnpm -r --filter "./packages/**" run build
pnpm --filter @gaesup-state/container-builder run build
pnpm --filter @gaesup-state/core exec vitest run src/__tests__/core.test.ts
```

The multi-framework demo runs at:

```bash
pnpm --filter @gaesup-state/multi-framework-demo run dev -- --host 0.0.0.0
```

Open `http://localhost:3000/`.

## Repository Map

```text
packages/core
  Container manager, compatibility guard, runtime adapters, shared store API.

packages/core-rust
  Rust/WASM package with JavaScript fallback files for development.

packages/adapter
  Framework-neutral adapter surface.

packages/frameworks/react
packages/frameworks/vue
packages/frameworks/svelte
packages/frameworks/angular
  Framework bindings over the same Gaesup store and container contracts.

tools/container-builder
  Builds WASM package manifests from builder APIs or Containerfile-style directives.

examples/multi-framework-demo
  React, Vue, Svelte, and Angular-like counters sharing one store.
```

## Primary Concepts

### Container manifest

Each WASM container can provide a manifest:

```typescript
import type { ContainerPackageManifest } from '@gaesup-state/core';

export const manifest: ContainerPackageManifest = {
  manifestVersion: '1.0',
  name: 'counter',
  version: '1.0.0',
  runtime: 'browser',
  gaesup: {
    abiVersion: '1.0'
  },
  dependencies: [
    { name: 'lodash', version: '^4.17.0' }
  ],
  stores: [
    {
      storeId: 'app',
      schemaId: 'counter-state',
      schemaVersion: '1.0.0',
      compatRange: '^1.0.0',
      conflictPolicy: 'reject'
    }
  ],
  permissions: {
    network: false,
    storage: 'scoped',
    dom: false,
    crossStore: false,
    crossContainer: false
  },
  allowedImports: ['env.memory']
};
```

### Compatibility guard

`CompatibilityGuard` validates:

- Manifest version and shape.
- Gaesup ABI compatibility.
- Host package dependency ranges.
- Store schema id and schema version.
- Conflict policy.
- Runtime import permissions.

Unsupported isolation modes are rejected for now. This is deliberate: if the runtime cannot enforce `isolate` or `readonly`, the manager refuses the package instead of pretending the boundary exists.

### Store registry

The core store API can register schema metadata:

```typescript
import { GaesupCore, createStoreAwareContainerManager } from '@gaesup-state/core';

await GaesupCore.createStore('app', { count: 0 }, {
  schema: {
    storeId: 'app',
    schemaId: 'counter-state',
    schemaVersion: '1.0.0'
  }
});

const manager = createStoreAwareContainerManager({
  defaultRuntime: 'browser'
});
```

The store-aware manager injects registered store schemas into compatibility checks.

## Documentation Index

- [Quick Start](./quick-start.md)
- [API Reference](./api-reference.md)
- [Architecture Overview](./01_architecture_overview.md)
- [Central Manager](./02_central_manager.md)
- [Apartment Routing](./03_apartment_routing.md)
- [Manifest Service](./04_manifest_service.md)
- [Design Tokens](./05_design_tokens.md)
- [Container Lifecycle](./06_container_lifecycle.md)
- [State Management](./07_state_management.md)
- [Observability](./08_observability.md)
- [Security and Isolation](./09_security_isolation.md)
- [CI/CD Pipeline](./10_cicd_pipeline.md)
- [Migration Guide](./11_migration_guide.md)
- [Performance Optimization](./12_performance_optimization.md)
- [Docker Integration](./docker-integration.md)
- [Performance Notes](./performance.md)

## Naming Note

`gaesup-store` is understandable, but the project now covers more than a store. It includes package compatibility, WASM loading, permissions, and framework adapters. If the project is renamed later, `gaesup-runtime` is the strongest option because it leaves room for store, container, registry, and execution concerns.
