# Central Manager

`ContainerManager` is the host-side authority for WASM containers.

## Responsibilities

- Resolve package manifests.
- Validate compatibility before instantiation.
- Apply manifest defaults to runtime config.
- Select the runtime adapter.
- Track running container instances.
- Expose metrics and lifecycle cleanup.

## Manifest Resolution

The manager uses `config.manifest` when provided. Otherwise it attempts to resolve a manifest from the configured registry path:

```text
/containers/{name}/manifest.json
```

## Store-Aware Manager

Use `createStoreAwareContainerManager()` when the host should automatically pass registered store schemas into compatibility checks:

```typescript
import { GaesupCore, createStoreAwareContainerManager } from '@gaesup-state/core';

GaesupCore.registerStoreSchema({
  storeId: 'app',
  schemaId: 'counter-state',
  schemaVersion: '1.0.0'
});

const manager = createStoreAwareContainerManager({
  defaultRuntime: 'browser'
});
```

## Failure Behavior

The manager fails closed. If a package asks for a dependency, schema, permission, or conflict policy that the host cannot satisfy, the container does not start.

This protects shared stores from silent drift.
