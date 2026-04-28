# Apartment Routing

This document describes the intended routing model for isolating multiple frontend containers in one host page.

## Concept

An apartment is a logical slot where a container can run with a scoped state contract and permission set.

```text
Host page
  -> Apartment route
  -> Container manifest
  -> Store schema contract
  -> Framework view
```

## Current Repository State

The repository currently implements the lower-level primitives:

- Manifest validation.
- Store schema registry.
- Container lifecycle.
- Framework subscriptions.

It does not yet include a full router package for apartments. Until that exists, route-level isolation should be implemented by the host app by creating separate store ids and separate manager instances.

## Recommended Pattern

```typescript
const storeId = `tenant:${tenantId}:app`;

await GaesupCore.createStore(storeId, initialState, {
  schema: {
    storeId,
    schemaId: 'tenant-app-state',
    schemaVersion: '1.0.0'
  }
});
```

Pass that `storeId` in the container manifest's `stores` section.
