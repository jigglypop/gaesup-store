# Migration Guide

## From Local Framework State

Before:

```typescript
const [count, setCount] = useState(0);
```

After:

```typescript
await GaesupCore.createStore('counter', { count: 0 });
await GaesupCore.dispatch('counter', 'MERGE', { count: 1 });
```

Framework components subscribe to the same store id.

## From Redux or Zustand

Map each store slice to a Gaesup store id:

```text
redux.counter -> GaesupCore store "counter"
redux.session -> GaesupCore store "session"
```

Keep action names stable while moving reducers:

```typescript
GaesupCore.registerReducer('counter', (state, action) => {
  if (action.type === 'increment') {
    return { ...state, count: state.count + 1 };
  }
  return state;
});
```

## Add Schema Metadata

Before connecting containers, register schemas:

```typescript
GaesupCore.registerStoreSchema({
  storeId: 'counter',
  schemaId: 'counter-state',
  schemaVersion: '1.0.0'
});
```

## Add Container Contracts

Add store dependencies to the container manifest:

```typescript
stores: [
  {
    storeId: 'counter',
    schemaId: 'counter-state',
    schemaVersion: '^1.0.0',
    conflictPolicy: 'reject'
  }
]
```
