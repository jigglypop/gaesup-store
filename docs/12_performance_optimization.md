# Performance Optimization

## Current Findings

The simplified demo shows that core dispatch is fast and framework rendering dominates visible latency.

Measured locally:

- Core dispatch p50: about 0.13ms.
- Core dispatch p95: about 0.29ms.
- Four framework counters visible after click p50: about 32ms.
- Four framework counters visible after click p95: about 65ms.

## Recommendations

### Keep Shared State Small

Store only the state needed by multiple consumers. Keep component-local UI state in the framework.

### Subscribe at Useful Boundaries

Subscribe to the store or path that the component needs:

```typescript
GaesupCore.subscribe('app', 'count', callbackId);
```

### Batch Related Updates

```typescript
const batch = GaesupCore.createBatchUpdate('app');
batch.addUpdate('MERGE', { a: 1 });
batch.addUpdate('MERGE', { b: 2 });
await batch.execute();
```

### Avoid Duplicate DOM in Demos

Duplicate ids make browser measurements and event targeting unreliable. Mount framework components into empty host elements.

### Measure Separately

Measure these independently:

- Core dispatch time.
- Time until store value changes.
- Time until all DOM subscribers are visible.
- Browser memory use.
