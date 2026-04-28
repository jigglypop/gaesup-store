# 성능 최적화

Gaesup-State의 성능 최적화는 “Rust로 옮기기” 자체보다 “경계를 적게 넘고, 작은 형태로 넘기기”가 핵심입니다.

## 상태 업데이트

개별 dispatch를 많이 반복하면 JS/WASM 경계 비용이 누적됩니다.

느린 패턴:

```typescript
for (let i = 0; i < 1000; i++) {
  await GaesupCore.dispatchCounter('shared', 1, 'bench', 'INCREMENT');
}
```

권장 패턴:

```typescript
await GaesupCore.dispatchCounterBatch('shared', 1, 1000, 'bench', 'INCREMENT');
```

가장 빠른 counter path:

```typescript
await GaesupCore.dispatchCounterBatchFast('shared', 1, 1000);
```

`dispatchCounter`는 demo metadata와 history를 만들기 때문에 일반 fast path가 아닙니다. count만 필요하면 `dispatchCounterFast` 또는 `dispatchCounterBatchFast`를 씁니다.

같은 store를 반복 갱신한다면 handle을 재사용합니다.

```typescript
const handle = await GaesupCore.createCounterHandle('shared');
await GaesupCore.dispatchCounterHandleFast(handle, 1);
await GaesupCore.dispatchCounterHandleBatchFast(handle, 1, 1000);
GaesupCore.releaseCounterHandle(handle);
```

검증된 handle을 매우 뜨거운 루프에서만 쓴다면 unchecked 경로도 있습니다.

```typescript
GaesupCore.dispatchCounterHandleFastUnchecked(handle, 1);
```

이 경로는 error 객체를 만들지 않기 때문에 빠르지만, 잘못된 handle을 넘기면 안전한 실패 대신 `NaN` 계열 결과를 받을 수 있습니다.

## select 줄이기

매 렌더마다 큰 store 전체를 읽는 것은 피합니다.

```typescript
const count = GaesupCore.select('shared', 'count');
```

필요한 path만 읽는 구조가 좋습니다.

## subscription 범위

구독 callback 안에서 큰 계산을 하지 않는 것이 좋습니다. callback은 상태 변경을 UI로 전달하는 얇은 통로로 유지합니다.

## render 최적화

R3F/WebGPU 쪽은 JSON patch보다 typed dirty buffer를 우선합니다.

```typescript
const dirty = GaesupRender.getDirtyMatrixBuffer('scene');
```

dirty buffer는 바뀐 instance index와 matrix만 넘깁니다.

```typescript
dirty.instanceIndices;
dirty.matrices;
```

## InstancedMesh

entity가 많으면 개별 mesh보다 `InstancedMesh`가 유리합니다. GaesupRender는 `instanceIndex`를 기준으로 matrix buffer를 만들 수 있습니다.

```typescript
await GaesupRender.createEntity('scene', {
  instanceIndex: 10,
  transform: {
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1]
  }
});
```

## WebGPU

WebGPU buffer에 쓸 때는 write 횟수를 줄이는 것이 중요합니다. 현재 bridge는 dirty matrix마다 `writeBuffer`를 호출할 수 있습니다. 이후에는 연속된 index를 묶어 range 단위로 쓰는 최적화가 필요합니다.

## 앞으로의 개선 후보

- numeric entity id
- packed dirty list
- WASM memory view 재사용
- GPU write range batching
- worker 기반 tick
- schema별 typed store
- render command buffer

## 측정 원칙

- dev build와 production build를 구분합니다.
- 첫 실행은 warm-up으로 제외합니다.
- 같은 조건에서 여러 번 측정합니다.
- core dispatch 시간과 화면 반영 시간을 따로 봅니다.
- JSON patch와 typed buffer를 같은 entity 수로 비교합니다.
