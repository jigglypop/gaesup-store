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

## 상태관리 라이브러리 비교

다음 명령으로 Gaesup, Zustand, Jotai, Redux를 같은 Node 프로세스에서 비교할 수 있습니다.

```bash
pnpm bench:compare
```

현재 스크립트는 다음 구현을 사용합니다.

- Gaesup: `packages/core-rust/pkg-node`의 Rust WASM 함수 직접 호출
- Zustand: `zustand/vanilla`
- Jotai: `jotai/vanilla`
- Redux: `redux`

최근 측정 환경:

- Node.js `v24.13.0`
- Windows 로컬 환경
- Gaesup은 JS/WASM 경계를 통과함
- Zustand, Jotai, Redux는 plain JS로 실행됨

측정 결과:

| Library | Test | Avg us/op |
| --- | --- | ---: |
| Gaesup | increment update rich | 62.156 |
| Gaesup | increment update fast | 0.462 |
| Gaesup | increment update handle | 0.295 |
| Gaesup | increment update unchecked | 0.193 |
| Zustand | increment update fast | 0.186 |
| Jotai | increment update fast | 1.431 |
| Redux | increment update fast | 0.158 |
| Gaesup | nested read | 0.434 |
| Zustand | nested read | 0.051 |
| Jotai | nested read | 0.278 |
| Redux | nested read | 0.049 |
| Gaesup | notify subscriber | 51.847 |
| Zustand | notify subscriber | 0.127 |
| Jotai | notify subscriber | 1.196 |
| Redux | notify subscriber | 0.166 |
| Gaesup | batch 1000 increments rich | 45.156 |
| Gaesup | batch 1000 increments fast | 0.523 |
| Gaesup | batch 1000 increments handle | 0.325 |
| Zustand | batch 1000 increments fast | 54.371 |
| Jotai | batch 1000 increments fast | 905.661 |
| Redux | batch 1000 increments fast | 68.217 |

해석:

- 기존 `dispatch_counter` rich 경로는 history JSON 생성, state clone, 전체 state 반환 때문에 느립니다.
- 새 `dispatch_counter_fast` 경로는 count cache만 바꾸고 숫자만 반환하므로 0.5us 아래로 내려갑니다.
- counter handle 경로는 `storeId` 문자열 lookup을 줄이고 전용 lane을 갱신하므로 0.3us 안팎까지 내려갑니다.
- unchecked handle 경로는 이미 검증한 핸들을 전제로 `Result` 에러 경로까지 제거해 0.2us 안팎까지 내려갑니다.
- 단일 fast update만 보면 Zustand와 Redux가 여전히 빠르지만, unchecked handle은 같은 범위까지 접근합니다.
- Jotai는 atom store 구조 때문에 단일 update에서 Gaesup fast path보다 느렸습니다.
- 1000개 논리 increment를 한 번의 Rust batch fast path로 처리하면 Gaesup이 Zustand와 Redux보다 크게 빨라집니다.
- 따라서 Gaesup은 “작은 update를 매번 넘기는 일반 상태관리”보다 “패키지 격리, schema 검증, batch 처리, render buffer”에 강점이 있습니다.

주의할 점:

- `batch 1000 increments fast`는 Gaesup은 Rust 내부 batch API를 사용하고, JS 라이브러리들은 1000번 update loop를 실행합니다.
- 단일 store update만 놓고 보면 기존 JS 상태관리 라이브러리가 더 빠른 것이 정상입니다.
- Gaesup이 이겨야 하는 구간은 경계 통과 횟수를 줄인 batch, container contract 검증, render typed buffer입니다.

## 병목 분석 결과

병목을 쪼개서 측정한 결과입니다.

| Case | Avg us/op |
| --- | ---: |
| select tiny count | 0.302 |
| dispatch SET tiny | 4.147 |
| dispatch MERGE tiny no sub | 6.099 |
| dispatch_counter rich | 56.240 |
| dispatch_counter_fast | 0.278 |
| dispatch_counter_handle_fast | 0.175 |
| dispatch_counter_handle_fast_unchecked | 0.106 |
| dispatch_counter with history | 38.608 |
| dispatch_counter_batch rich 1000 | 39.499 |
| dispatch_counter_batch_fast 1000 | 0.646 |
| dispatch_counter_handle_batch_fast 1000 | 0.429 |
| dispatch MERGE root subscriber | 3.020 |
| dispatch MERGE path subscriber | 2.678 |

이 결과로 알 수 있는 것은 명확합니다. JS/WASM 경계 자체가 항상 30us인 것이 아닙니다. `select`는 0.3us, 일반 `SET/MERGE`도 3-4us입니다. 기존 `dispatch_counter`가 느렸던 이유는 counter 전용 경로가 demo history까지 같이 만들었기 때문입니다.

새 fast path는 다음을 하지 않습니다.

- history JSON 객체 생성
- 전체 state clone
- `lastUpdated`와 `framework` 기록
- 전체 state를 `JsValue`로 변환해서 반환
- subscriber callback 호출

대신 `count`만 in-place로 갱신하고 새 count 숫자만 반환합니다.

counter handle path는 여기서 한 단계 더 줄입니다.

- JS에서 매번 `storeId` 문자열을 넘기지 않습니다.
- Rust는 전용 counter lane만 갱신합니다.
- 전체 state가 필요할 때만 lane 값을 store JSON에 flush합니다.
- `select(storeId, 'count')`는 lane 값을 바로 읽어 상태 어긋남 없이 최신 count를 반환합니다.

unchecked handle path는 존재하지 않는 handle 에러를 검사하지 않습니다. 이미 `createCounterHandle`로 검증한 핸들을 매우 뜨거운 루프에서 재사용할 때만 써야 합니다.

## Render 측정 감

| 작업 | 관찰된 성능 |
| --- | ---: |
| render JSON patch 10,000개 | 약 70ms대 |
| render 전체 matrix buffer 10,000개 | 약 10ms대 후반 |
| dirty matrix buffer 1,000개 갱신 | 약 1ms대 |
| dirty matrix buffer 10,000개 갱신 | 약 2ms대 |
| dirty entity 1개 fast tick | 1ms 미만 |

render 쪽은 JSON patch보다 typed dirty buffer가 중요합니다. JSON patch는 디버깅하기 좋지만, 10,000개 transform을 매 프레임 넘기기에는 무겁습니다. dirty typed buffer는 `Uint32Array`와 `Float32Array` 중심이라 훨씬 가볍습니다.

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

typed dirty buffer는 이런 형태입니다.

```typescript
{
  count: 1000,
  instanceIndices: Uint32Array,
  matrices: Float32Array
}
```

typed dirty buffer의 장점:

- JS 객체 수가 적습니다.
- GPU buffer에 쓰기 쉽습니다.
- instanced rendering과 잘 맞습니다.

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

| 개선 | 기대 효과 |
| --- | --- |
| 단일 counter update 반환값 최소화 | 단일 update의 `JsValue` 변환 비용 감소 |
| subscribe callback batching | WASM -> JS callback 비용 감소 |
| dirty set을 numeric id 기반으로 전환 | dirty 추적 비용 감소 |
| WASM memory view 재사용 | typed array 생성 비용 감소 |
| GPU write range batching | `queue.writeBuffer` 호출 수 감소 |
| worker runtime | UI thread 부담 감소 |
| schema별 typed store | `JsValue` 변환 비용 감소 |

## 해석할 때 주의할 점

- dev mode는 production build보다 느릴 수 있습니다.
- 브라우저 탭이 background 상태면 timer와 frame이 throttle 됩니다.
- 첫 실행은 WASM 초기화와 JIT warm-up이 섞일 수 있습니다.
- 작은 데이터에서는 Rust/WASM 호출 비용이 계산 비용보다 클 수 있습니다.
- 큰 데이터에서는 JSON과 객체 생성 비용이 병목이 되기 쉽습니다.

성능 판단은 같은 작업을 같은 조건에서 여러 번 측정해야 합니다. 지금 코드의 방향은 Rust 계산을 빠르게 만드는 것보다, 프레임마다 넘어가는 데이터의 양과 형태를 통제하는 쪽에 더 가깝습니다.
