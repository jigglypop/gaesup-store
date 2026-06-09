# AGENTS.md

## Project Direction

Gaesup should be treated as a **WASM-based State Contract Runtime for partially deployed frontend containers**, not merely as a faster Redux/Zustand replacement.

The strongest commercial positioning is:

> Frontend containers can be independently deployed, validated through manifests, attached to shared state only through schema contracts, and orchestrated through predictable step/state-machine workflows.

This means the core product surface is the combination of:

- WASM state engine
- Container manifest validation
- Store schema compatibility guard
- Framework adapters
- Partial deployment workflow
- Step/state-machine runtime
- Observability and rollback support

## Current Strengths

- Rust/WASM core already owns named stores, dispatch, select, subscribe, snapshots, metrics, fast counter lanes, and render-state fast paths.
- TypeScript API already provides ergonomic state APIs such as `GaesupCore`, `gaesup`, `atom`, `resource`, `query`, and dispatch pipelines.
- Manifest validation already covers ABI, dependencies, store schema, accelerators, and deployment slot checks.
- Multi-framework adapters and demos already point toward React/Vue/Svelte/Angular interoperability.
- Monorepo container examples already suggest partial deployment through per-container manifests.

## Commercial Gaps

### 1. Container Runtime Is Not Yet a Real Sandbox

Current `container.rs` is closer to a lightweight in-memory container registry than a true WASM container runtime.

Needed:

- Load and instantiate external `.wasm` modules.
- Enforce `allowedImports`.
- Inject host functions through a capability table.
- Run containers in Worker or iframe isolation where browser security requires it.
- Separate container memory, storage, event channels, and network access.

### 2. Permission Model Is Mostly Declarative

Manifest fields such as `permissions` and `allowedImports` must become enforced runtime policy.

Needed:

- Fail closed by default.
- Signature/hash verification for container artifacts.
- CSP guidance for host applications.
- Storage namespace isolation.
- Network permission enforcement.
- Runtime audit logs for denied capabilities.

### 3. Generic JSON State Path Can Become a Bottleneck

WASM is useful when state transitions are compact, frequent, and predictable. It is less useful when large JSON objects repeatedly cross the JS/WASM boundary.

Needed:

- Keep ergonomic JSON store for normal UI state.
- Add typed fast lanes for hot paths.
- Prefer batch/pipeline updates for multi-mutation flows.
- Avoid cloning entire state trees on every dispatch where possible.
- Add selector/path-level invalidation so UI adapters do not rerender unnecessarily.

### 4. Framework Adapters Need Production Contracts

Adapters should stay thin, but they need consistent lifecycle and reactivity semantics.

Needed:

- Define a shared adapter contract: `mount`, `unmount`, `subscribe`, `dispatch`, `getSnapshot`, `onError`.
- Guarantee cleanup of subscriptions on unmount.
- Provide React/Vue/Svelte/Angular reference adapters with the same behavior.
- Add tests for repeated mount/unmount, failed mount, and isolated store fallback.

### 5. Store Schema Migration Is Incomplete

`reject` and `isolate` are good starting policies, but commercial deployments need controlled upgrade paths.

Needed:

- `migrate`: run schema migration before attaching to shared store.
- `readonly`: allow reads but reject writes for incompatible containers.
- `shadow`: run incompatible container against copied state for preview/testing.
- `dual-write`: write old and new schema during gradual migration.

### 6. Observability Is Not Yet Operator-Grade

Commercial users need to understand what happened during load, validation, state transitions, rollback, and isolation.

Needed:

- Runtime timeline events.
- Manifest validation result reporting.
- Container lifecycle metrics.
- Store transition metrics.
- Step-machine transition logs.
- DevTools panel or Redux DevTools bridge with container/step context.

### 7. Partial Deployment Needs First-Class CI/CD

The repository already has container manifests, but the release flow should become explicit.

Needed:

- Detect changed containers in GitHub Actions.
- Validate only affected manifests.
- Build only affected artifacts.
- Update registry slots independently.
- Block deployment when compatibility checks fail.
- Support rollback by switching registry slot pointers.

## Proposed Methodology

Use the following mental model:

```text
Apartment = whole frontend application
Building  = route, domain, or visible shell region
Unit      = deployable version/slot for a building
Container = actual runtime artifact loaded by the host
Store     = shared state contract boundary
Machine   = step/workflow contract boundary
```

The host application should not trust a container because it loads successfully. It should trust it only after:

1. Artifact hash/signature is valid.
2. ABI is compatible.
3. Store schemas are compatible or safely isolated.
4. Permissions are approved.
5. Imports are allowed.
6. Deployment slot contract is satisfied.

## Step/State-Machine Direction

Gaesup should support an XState-like workflow model, but it should start smaller and optimize for WASM execution.

Do not attempt to clone all of XState immediately. The first version should focus on deterministic step workflows.

### Core Idea

Pure transition logic runs in Rust/WASM. Side effects run in JS host code after permission checks.

```text
event
  -> WASM transition engine
  -> next state/context
  -> effect descriptors
  -> JS host executes permitted effects
  -> effect result sends next event
```

### Initial Machine API Sketch

```ts
const checkout = gaesupMachine({
  id: 'checkout',
  initial: 'cart',
  context: {
    items: [],
    paymentId: null
  },
  states: {
    cart: {
      on: {
        NEXT: { target: 'shipping', guard: 'hasItems' }
      }
    },
    shipping: {
      on: {
        NEXT: { target: 'payment' },
        BACK: { target: 'cart' }
      }
    },
    payment: {
      on: {
        PAY: { target: 'processing', action: 'requestPayment' }
      }
    },
    processing: {
      on: {
        RESOLVE: { target: 'done' },
        REJECT: { target: 'payment' }
      }
    },
    done: { final: true }
  }
});
```

### Machine V1 Scope

- Flat finite states.
- Event transitions.
- Guards by name.
- Assign/context updates.
- Entry/exit/action descriptors by name.
- Final states.
- Snapshots.
- Step history.
- Undo/rollback to previous snapshot.
- Integration with store metrics and DevTools timeline.

### Machine V2 Scope

- Nested states.
- Parallel states.
- Delayed transitions.
- Actor-like child machines.
- Promise/observable/websocket actors.
- Visual editor import/export.
- Optional SCXML-inspired compatibility layer.

## Implementation Plan

### Phase 1: Product Contract

- Write `docs/state-contract-runtime.md`.
- Write `docs/container-manifest-spec.md`.
- Write `docs/machine-runtime.md`.
- Normalize terminology around Host, Container, Store, Manifest, Machine, Adapter, Slot.
- Decide which APIs are stable public surface and which are experimental.

### Phase 2: Runtime Guardrails

- Enforce `allowedImports` in container loading path.
- Add artifact hash verification to container builder/loader.
- Add explicit capability registry for host functions.
- Add runtime validation errors with stable error codes.
- Add tests for fail-closed behavior.

### Phase 3: Performance Split

- Keep current JSON store as the default ergonomic path.
- Add typed transition/fast-lane APIs for hot state.
- Add changed-path notification metadata from Rust dispatch.
- Make framework adapters use path/selector invalidation.
- Benchmark JSON path vs batch path vs typed path.

### Phase 4: Step Machine Runtime

- Add Rust machine module for flat state transitions.
- Add TS wrapper: `createMachine`, `createActor`, `send`, `subscribe`, `getSnapshot`.
- Store machine snapshots in Gaesup store.
- Return action/effect descriptors to JS instead of executing side effects in WASM.
- Add tests for guards, invalid transitions, final state, rollback, and persisted snapshots.

### Phase 5: Partial Deployment CI

- Add GitHub Actions workflow for changed container detection.
- Build a matrix from changed container directories.
- Validate affected manifests against host deployment contract.
- Upload affected artifacts only.
- Update registry JSON slot pointers only for successfully validated containers.
- Add rollback script that rewrites slot pointer to previous artifact.

### Phase 6: Observability

- Add event timeline:
  - manifest fetched
  - manifest validated
  - container loaded
  - store attached
  - store isolated
  - machine transitioned
  - effect requested
  - effect denied
  - container stopped
- Expose metrics through `GaesupCore.getRuntimeMetrics()`.
- Extend DevTools bridge with container id, store id, machine id, state, event, and transition duration.

## Priorities

Do first:

1. Machine V1 design and docs.
2. Changed-path notification from Rust store dispatch.
3. Manifest enforcement for imports/permissions.
4. Partial deployment GitHub Actions draft.
5. Benchmarks that separate JSON, batch, typed, and machine transitions.

Avoid for now:

- Full XState compatibility.
- Full browser Docker claims.
- Heavy visual editor work.
- Parallel/nested statecharts before flat step workflows are stable.
- Over-optimizing generic JSON state before measuring real adapter rerender costs.

## Success Criteria

The methodology is commercially credible when the project can demonstrate:

- A changed container can be built and deployed without rebuilding the whole app.
- An incompatible store schema is blocked or isolated before mount.
- A step machine transition is deterministic, observable, and rollbackable.
- A hot update path is measurably faster than JS object-state alternatives.
- React/Vue/Svelte/Angular containers can share state without direct framework coupling.
- Operators can inspect why a container loaded, failed, isolated, or rolled back.
