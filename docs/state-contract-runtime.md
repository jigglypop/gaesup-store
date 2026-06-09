# State Contract Runtime

Gaesup is a state contract runtime for frontend containers. It should not be positioned only as a fast state library. The runtime exists to let independently deployed frontend modules share state safely, validate their execution contracts before mount, and expose predictable operational behavior.

## Positioning

Gaesup combines four responsibilities:

- A Rust/WASM state engine.
- A manifest compatibility guard.
- A framework-neutral adapter boundary.
- A partial deployment model for frontend containers.

The runtime should answer one question before a container is mounted:

```text
Can this container safely run in this host and attach to these stores?
```

If the answer is no, the container must be rejected, isolated, downgraded to read-only behavior, or migrated through an explicit policy.

## Runtime Model

```text
Host
  -> loads registry
  -> fetches container manifest
  -> validates ABI, dependency, permission, import, store, and deployment contracts
  -> creates or attaches stores
  -> mounts container through a framework adapter
  -> records lifecycle and transition telemetry
```

### Host

The host is the trusted shell. It owns:

- Runtime configuration.
- Registered store schemas.
- Deployment slots.
- Capability registry.
- Container registry client.
- Observability pipeline.
- Framework adapter registration.

The host must fail closed. A container that cannot be validated should not mount into a shared state boundary.

### Container

A container is a deployable frontend artifact. It may be:

- ESM JavaScript.
- WASM module.
- Framework bundle mounted through `mount` and `unmount`.
- Worker-isolated runtime unit.

A container must declare its requirements in a manifest.

### Store

A store is the shared state boundary. Stores are addressed by `storeId` and guarded by schema metadata.

```ts
{
  storeId: 'orders',
  schemaId: 'orders-state',
  schemaVersion: '1.2.0'
}
```

Containers should never assume that a store with the same id is compatible. Compatibility is defined by `schemaId`, `schemaVersion`, and policy.

### Adapter

Adapters translate Gaesup store updates into framework reactivity. They should stay thin.

An adapter should not own business state. It should only:

- Subscribe to Gaesup stores.
- Apply selector/path invalidation.
- Trigger framework-native rerender/reactivity.
- Clean up on unmount.

### Machine

A machine is a deterministic step/workflow contract. It is separate from generic UI state.

Machines are useful when the host and containers need to agree on allowed transitions, rollback points, and observable progress.

## Address Model

Use this terminology for partial deployment:

```text
Apartment = whole frontend application
Building  = route, domain, or visible shell region
Unit      = deployable version or slot inside a building
Container = runtime artifact loaded by the host
Store     = shared state contract boundary
Machine   = step/workflow contract boundary
```

Example:

```text
Apartment: commerce-web
Building: checkout
Unit: checkout-payment@1.4.2
Container: https://cdn.example.com/checkout-payment/1.4.2/container.js
Store: checkout
Machine: checkout-flow
```

## Store Conflict Policies

### reject

Block mount when the required store schema does not match the host store schema.

Use for:

- Shared checkout state.
- Payments.
- Auth state.
- Any state where corruption is worse than failed mount.

### isolate

Mount the container against a container-local namespace instead of the shared store.

Use for:

- Experiments.
- Preview deployments.
- Legacy widgets.
- Non-critical personalization.

### readonly

Allow reads from the host store but reject writes.

Use for:

- Dashboards.
- Analytics widgets.
- Legacy display-only widgets.

### migrate

Run an explicit migration before attaching to the shared store.

Use for:

- Controlled schema upgrades.
- Release windows with known migration scripts.

### shadow

Attach the container to a copied store and record what it would have done.

Use for:

- Canary testing.
- Migration rehearsals.
- Comparing new workflow behavior.

### dual-write

Write old and new schemas during a transition period.

Use for:

- Gradual rollouts.
- Cross-version compatibility windows.

## Performance Model

Gaesup should expose two clear paths.

### Ergonomic JSON Path

Use this for normal UI state:

- `gaesup`
- `atom`
- `resource`
- `query`
- `GaesupCore.dispatch`

This path is optimized for developer experience and cross-framework consistency.

### Hot Path

Use this for high-frequency and predictable data:

- Typed buffers.
- Compiled machine transitions.
- Counter/render fast lanes.
- Batched updates.
- Path-level invalidation.

This path should minimize JS/WASM boundary cost and avoid full JSON state transfer.

## Commercial Readiness Requirements

The runtime is commercially credible when it can demonstrate:

- Changed containers can deploy independently.
- Incompatible store schemas are blocked or isolated before mount.
- Permission and import policies are enforced, not only declared.
- Step transitions are deterministic and inspectable.
- Operators can inspect why a container loaded, failed, isolated, or rolled back.
- Hot paths are benchmarked separately from generic JSON state.

## Implementation Notes

Short-term priorities:

1. Emit changed path metadata from Rust dispatch.
2. Make framework adapters use path/selector invalidation.
3. Add a runtime capability registry.
4. Add artifact hash verification in the loader path.
5. Add a flat machine runtime for step workflows.

Avoid claiming full browser-container isolation until external WASM modules, import enforcement, worker/iframe isolation, and permission enforcement exist.
