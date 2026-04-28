# State Management

Gaesup-State exposes named stores through `GaesupCore`.

## Create

```typescript
await GaesupCore.createStore('app', { count: 0 }, {
  schema: {
    storeId: 'app',
    schemaId: 'counter-state',
    schemaVersion: '1.0.0'
  }
});
```

## Read

```typescript
const state = GaesupCore.select('app', '');
const count = GaesupCore.select('app', 'count');
```

## Write

```typescript
await GaesupCore.dispatch('app', 'MERGE', { count: 1 });
await GaesupCore.dispatch('app', 'UPDATE', { path: 'count', value: 2 });
await GaesupCore.dispatch('app', 'SET', { count: 0 });
```

## Subscribe

```typescript
const callbackId = 'listener';

GaesupCore.registerCallback(callbackId, () => {
  console.log(GaesupCore.select('app', ''));
});

const subscriptionId = GaesupCore.subscribe('app', '', callbackId);
```

Always register the callback before subscribing.

## Snapshots

```typescript
const snapshotId = await GaesupCore.createSnapshot('app');
await GaesupCore.restoreSnapshot('app', snapshotId);
```

## Persistence

```typescript
await GaesupCore.persist_store('app', 'app-state');
await GaesupCore.hydrate_store('app', 'app-state');
```
