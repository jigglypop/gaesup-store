# 관측성

Gaesup-State에서 관측성은 store, container, render runtime이 실제로 어떻게 동작하는지 확인하기 위한 정보입니다.

## store metrics

```typescript
const metrics = await GaesupCore.getMetrics('orders');
```

대표 필드:

| 필드 | 의미 |
| --- | --- |
| `subscriber_count` | 구독자 수 |
| `total_selects` | select 호출 수 |
| `total_updates` | update 수 |
| `total_dispatches` | dispatch 수 |
| `avg_dispatch_time` | 평균 dispatch 시간 |
| `memory_usage` | 추정 메모리 사용량 |

이 값은 demo에서 병목이 core에 있는지, 화면 반영에 있는지 판단하는 데 도움을 줍니다.

## container metrics

```typescript
const metrics = container.getMetrics();
```

container metrics는 lifecycle 상태, call 횟수, error 상태 같은 정보를 표시하는 데 사용할 수 있습니다.

## render benchmark

```typescript
const full = await GaesupRender.benchmarkMatrixBuffer(10000);
const dirty = await GaesupRender.benchmarkDirtyMatrixBuffer(10000, 1000);
```

render benchmark는 JSON patch 대신 typed buffer를 쓰는 경로가 실제로 얼마나 가벼운지 확인하는 데 씁니다.

## 로그 원칙

- manifest 검증 실패는 error code를 남깁니다.
- bundled dependency는 warning 또는 info로 표시합니다.
- isolated store는 실행 가능하지만 공유 상태가 아니라는 점을 표시합니다.
- render benchmark는 환경 차이가 크므로 절대값보다 비교값을 봅니다.

## 앞으로 필요한 것

- browser performance mark 연동
- devtools panel
- store별 timeline
- manifest 검증 결과 캐시
- render frame budget 표시
- WebGPU buffer write 횟수 표시
