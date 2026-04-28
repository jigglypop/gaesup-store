# Observability

## Store Metrics

```typescript
const metrics = await GaesupCore.getMetrics('app');
```

Common fields:

- `store_id`
- `subscriber_count`
- `total_selects`
- `total_updates`
- `total_dispatches`
- `avg_dispatch_time`
- `memory_usage`

## Container Metrics

```typescript
const metrics = manager.getMetrics();
```

Container metrics are keyed by container id.

## Demo Measurements

The simplified multi-framework demo measured locally:

- Initial ready time: about 827ms.
- Four-counter DOM update after click, p50: about 32ms.
- Four-counter DOM update after click, p95: about 65ms.
- Direct core dispatch, p50: about 0.13ms.

The main cost is framework rendering and browser scheduling, not store dispatch.
