# 성능 메모

이 문서는 현재 Gaesup-State의 성능 방향과 최근 측정값을 정리합니다. 숫자는 실행 환경, 브라우저, dev server 상태, CPU/GPU 상태에 따라 달라질 수 있습니다. 중요한 것은 절대값보다 병목이 어디로 이동했는지입니다.

## 결론

Rust/WASM으로 옮긴다고 모든 경로가 자동으로 빨라지지는 않습니다. 특히 다음 비용은 여전히 큽니다.

- JS/WASM 경계 왕복
- JSON 직렬화와 역직렬화
- JS 객체 대량 생성
- React/R3F reconciliation
- GPU buffer write 호출 수

그래서 Gaesup-State의 fast path는 다음 방향으로 갑니다.

- 자주 반복되는 update는 batch 처리
- 대량 렌더 데이터는 JSON patch 대신 typed array 사용
- 전체 갱신보다 dirty 갱신 우선
- R3F state 변경보다 matrix buffer 직접 반영 우선

## 최근 측정 감

| 작업 | 관찰된 성능 |
| --- | ---: |
| 개별 counter dispatch 1000회 | 수백 ms대 |
| counter batch 1000회 | 1ms 안팎까지 가능 |
| render JSON patch 10,000개 | 약 70ms대 |
| render 전체 matrix buffer 10,000개 | 약 10ms대 후반 |
| dirty matrix buffer 1,000개 갱신 | 약 1ms대 |
| dirty matrix buffer 10,000개 갱신 | 약 2ms대 |
| dirty entity 1개 fast tick | 1ms 미만 |

개별 dispatch가 느린 이유는 Rust 계산 자체보다 JS/WASM 호출을 1000번 반복하는 비용이 큽니다. batch API는 같은 작업을 한 번의 경계 통과로 처리하기 때문에 훨씬 유리합니다.

render 쪽도 비슷합니다. JSON patch는 디버깅하기 좋지만 10,000개 transform을 매 프레임 넘기기에는 무겁습니다. dirty typed buffer는 `Uint32Array`와 `Float32Array` 중심이라 훨씬 가볍습니다.

## CPU 내장 GPU 환경에서의 의미

전용 GPU가 없는 환경에서도 fast path는 의미가 있습니다. 병목이 GPU 연산이 아니라 JS 객체 생성, JSON 처리, 프레임워크 리렌더, buffer 전달 비용인 경우가 많기 때문입니다.

내장 GPU 환경에서는 다음 전략이 특히 중요합니다.

- 움직인 entity만 dirty로 넘깁니다.
- R3F component state를 매 프레임 바꾸지 않습니다.
- `InstancedMesh`의 matrix를 직접 갱신합니다.
- WebGPU buffer write는 가능한 범위를 묶습니다.
- UI 상태와 render 상태를 분리합니다.

## Rust 테스트

Rust core는 native test와 wasm target check를 같이 봅니다.

```bash
cd packages/core-rust
cargo test
cargo check --target wasm32-unknown-unknown --features wasm
```

`cargo test`는 `crate-type = ["cdylib", "rlib"]` 설정 덕분에 native Rust 테스트도 실행할 수 있습니다.

## 렌더 벤치마크 API

브라우저 또는 테스트 코드에서 render fast path를 직접 확인할 수 있습니다.

```typescript
const full = await GaesupRender.benchmarkMatrixBuffer(10000);
const dirty = await GaesupRender.benchmarkDirtyMatrixBuffer(10000, 1000);
```

`benchmarkMatrixBuffer`는 전체 matrix buffer를 만드는 비용을 봅니다. `benchmarkDirtyMatrixBuffer`는 전체 entity 중 일부만 dirty일 때의 비용을 봅니다.

## JSON patch와 typed buffer 비교

JSON patch는 이런 형태입니다.

```typescript
{
  dirty: {
    transforms: [
      {
        entityId: 'cube',
        instanceIndex: 0,
        matrix: [/* 16 numbers */],
        transform: { /* position, rotation, scale */ }
      }
    ]
  }
}
```

장점:

- 사람이 읽기 쉽습니다.
- 디버깅하기 좋습니다.
- 일반 object patch 적용이 쉽습니다.

단점:

- entity 수가 많으면 객체 생성이 많습니다.
- matrix 배열이 JS number array로 만들어집니다.
- 매 프레임 큰 JSON 구조를 넘기면 비용이 큽니다.

typed dirty buffer는 이런 형태입니다.

```typescript
{
  count: 1000,
  instanceIndices: Uint32Array,
  matrices: Float32Array
}
```

장점:

- JS 객체 수가 적습니다.
- GPU buffer에 쓰기 쉽습니다.
- instanced rendering과 잘 맞습니다.

단점:

- 사람이 읽기 어렵습니다.
- entityId 중심 patch가 필요한 화면에는 별도 mapping이 필요합니다.

## R3F에서 권장 흐름

R3F 화면에서 매 프레임 React state를 업데이트하는 방식은 피하는 편이 좋습니다.

권장 흐름:

1. UI 상태는 일반 store로 관리합니다.
2. transform, screen transition, animation state는 render store로 관리합니다.
3. `useFrame`에서는 Rust render store를 tick 합니다.
4. dirty matrix buffer만 `InstancedMesh` 또는 WebGPU buffer에 반영합니다.

예시:

```typescript
useFrame(async (_, delta) => {
  await GaesupRender.rotateY('scene', cubeId, delta);
  await bridge.tick(delta * 1000);
});
```

실제 앱에서는 `await`가 프레임 루프에 부담이 될 수 있으므로, 이후에는 worker 또는 pre-scheduled update queue로 분리하는 방향을 고려할 수 있습니다.

## 더 빨라질 수 있는 지점

현재 구조에서 추가로 개선할 수 있는 부분은 다음입니다.

| 개선 | 기대 효과 |
| --- | --- |
| dirty set을 문자열 기반에서 numeric id 기반으로 전환 | dirty 추적 비용 감소 |
| entity id to instance index mapping 고정 | 매 프레임 lookup 감소 |
| WASM memory view 재사용 | typed array 생성 비용 감소 |
| GPU write range batching | `queue.writeBuffer` 호출 수 감소 |
| worker runtime | UI thread 부담 감소 |
| schema별 typed store | `JsValue` 변환 비용 감소 |
| render command buffer | 화면 전환과 transform update를 더 compact하게 전달 |

## 해석할 때 주의할 점

- dev mode는 production build보다 느릴 수 있습니다.
- 브라우저 탭이 background 상태면 timer와 frame이 throttle 됩니다.
- 첫 실행은 WASM 초기화와 JIT warm-up이 섞일 수 있습니다.
- 작은 데이터에서는 Rust/WASM 호출 비용이 계산 비용보다 클 수 있습니다.
- 큰 데이터에서는 JSON과 객체 생성 비용이 병목이 되기 쉽습니다.

성능 판단은 “같은 작업을 같은 조건에서 여러 번” 측정해야 합니다. 지금 코드의 방향은 Rust 계산을 빠르게 만드는 것보다, 프레임마다 넘어가는 데이터의 양과 형태를 통제하는 쪽에 더 가깝습니다.
