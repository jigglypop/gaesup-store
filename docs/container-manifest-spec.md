# Container Manifest Spec

The container manifest is the execution contract between a frontend container and the host runtime.

The manifest must be validated before the container is loaded, instantiated, or attached to a shared store.

## Goals

- Make container requirements explicit.
- Prevent dependency and store schema drift.
- Support partial deployment by slot.
- Support capability-based host functions.
- Create stable diagnostics for CI and runtime operators.

## Minimal Manifest

```json
{
  "manifestVersion": "1.0",
  "name": "@shop/header",
  "version": "1.4.0",
  "runtime": "esm",
  "gaesup": {
    "abiVersion": "^1.0.0",
    "minHostVersion": "0.2.0"
  },
  "entry": {
    "type": "module",
    "url": "https://cdn.example.com/header/1.4.0/container.js",
    "sha256": "..."
  },
  "dependencies": [],
  "stores": [],
  "machines": [],
  "permissions": {},
  "allowedImports": [],
  "deployment": {
    "slot": "header",
    "releaseId": "web-2026-04-28.1",
    "slotVersion": "1.4.0",
    "contractVersion": "1.1.0"
  }
}
```

## Top-Level Fields

### manifestVersion

Manifest schema version. The first supported version is `1.0`.

### name

Package or container name. Prefer scoped package names for independently deployed containers.

### version

Container artifact version.

### runtime

Supported values:

- `esm`: JavaScript module loaded by the browser.
- `wasm`: WASM module loaded by the Gaesup host.
- `worker`: Worker-isolated JavaScript or WASM container.
- `iframe`: iframe-isolated UI container.

### gaesup

Gaesup runtime compatibility.

```json
{
  "abiVersion": "^1.0.0",
  "minHostVersion": "0.2.0"
}
```

The host must reject containers that require an incompatible ABI.

### entry

Artifact entry point.

```json
{
  "type": "module",
  "url": "https://cdn.example.com/body/1.8.0/container.js",
  "sha256": "..."
}
```

For WASM:

```json
{
  "type": "wasm",
  "url": "https://cdn.example.com/checkout/1.0.0/main.wasm",
  "sha256": "...",
  "entrypoint": "main"
}
```

The host should verify `sha256` before execution. In monorepo/container CI, local WASM artifacts can also be declared with:

```json
{
  "wasm": {
    "path": "container.wasm",
    "sha256": "sha256:..."
  }
}
```

Registry slot updates must fail closed when the declared artifact file is missing or its hash does not match.

## Dependencies

Dependencies define whether a package must be provided by the host or bundled inside the container.

```json
[
  {
    "name": "date-fns",
    "version": "^2.29.0",
    "source": "host"
  },
  {
    "name": "chart.js",
    "version": "^3.9.0",
    "source": "bundled"
  }
]
```

### source: host

The host must provide a compatible dependency. If the provided version does not satisfy the required range, validation fails.

### source: bundled

The container uses its own dependency copy. This should not mutate or rely on the host dependency graph.

## Stores

Stores declare shared state requirements.

```json
[
  {
    "storeId": "orders",
    "schemaId": "orders-state",
    "schemaVersion": "^1.2.0",
    "conflictPolicy": "reject",
    "required": true
  }
]
```

Supported conflict policies:

- `reject`
- `isolate`
- `readonly`
- `migrate`
- `shadow`
- `dual-write`

The default should be `reject`.

## Machines

Machines declare deterministic step/workflow requirements.

```json
[
  {
    "machineId": "checkout-flow",
    "schemaId": "checkout-machine",
    "schemaVersion": "^1.0.0",
    "storeId": "checkout",
    "conflictPolicy": "reject"
  }
]
```

Machines should be versioned separately from generic store schemas because workflow compatibility can change even when context shape is stable.

## Permissions

Permissions describe what the container may ask the host to do.

```json
{
  "network": {
    "enabled": true,
    "allow": ["https://api.example.com"]
  },
  "storage": {
    "mode": "namespace",
    "namespace": "checkout"
  },
  "dom": true,
  "crossStore": false,
  "crossContainer": false,
  "effects": ["requestPayment", "trackAnalytics"]
}
```

The host must enforce permissions when a capability is requested.

## allowedImports

For WASM containers, `allowedImports` limits host functions that can be imported.

```json
[
  "gaesup:store/select",
  "gaesup:store/dispatch",
  "gaesup:machine/send",
  "gaesup:effect/request"
]
```

Any import outside this list must fail before instantiation.

## Deployment

Deployment metadata ties a container to a slot.

```json
{
  "slot": "body",
  "releaseId": "web-2026-04-28.1",
  "slotVersion": "1.8.0",
  "contractVersion": "1.2.0",
  "requires": [
    {
      "slot": "header",
      "releaseId": "web-2026-04-28.1",
      "slotVersion": "^1.4.0",
      "contractVersion": "^1.1.0"
    }
  ]
}
```

This lets GitHub Actions or a registry service update one slot while validating peer slot contracts.

## Validation Order

Recommended validation order:

1. Manifest schema.
2. Artifact hash/signature.
3. Gaesup ABI.
4. Host dependency versions.
5. Store contracts.
6. Machine contracts.
7. Permissions.
8. Allowed imports.
9. Deployment slot contract.

Validation should return stable error codes.

## Stable Error Codes

Recommended codes:

- `MANIFEST_SCHEMA_INVALID`
- `ARTIFACT_HASH_MISMATCH`
- `ABI_VERSION_MISMATCH`
- `PACKAGE_DEPENDENCY_MISSING`
- `PACKAGE_DEPENDENCY_VERSION_MISMATCH`
- `STORE_SCHEMA_MISSING`
- `STORE_SCHEMA_CONFLICT`
- `STORE_SCHEMA_ISOLATED`
- `MACHINE_SCHEMA_CONFLICT`
- `PERMISSION_DENIED`
- `IMPORT_NOT_ALLOWED`
- `DEPLOYMENT_RELEASE_MISMATCH`
- `DEPLOYMENT_SLOT_VERSION_MISMATCH`
- `DEPLOYMENT_SLOT_CONTRACT_MISMATCH`

## CI Usage

Partial deployment CI should:

1. Detect changed container directories.
2. Read each changed container manifest.
3. Validate against the host deployment contract.
4. Build and upload only valid changed containers.
5. Update only the affected registry slots.
6. Keep previous slot versions for rollback.

The host should treat the registry as a pointer table, not as proof that a container is safe.
