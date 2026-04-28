# 관측성

## Store metrics

```typescript
const metrics = await GaesupCore.getMetrics('orders');
```

주요 값:

- `subscriber_count`
- `total_selects`
- `total_updates`
- `total_dispatches`
- `avg_dispatch_time`
- `memory_usage`

## Container metrics

```typescript
const metrics = manager.getMetrics();
```

container id별 metrics를 확인할 수 있습니다.

## 데모 기준 측정

최근 로컬 측정:

```text
초기 ready: 약 827ms
네 카운터 전체 반영 p50: 약 32ms
네 카운터 전체 반영 p95: 약 65ms
core dispatch p50: 약 0.13ms
```

화면 반영 비용이 store dispatch 비용보다 큽니다.
