# Render runtime

Render runtime은 R3F, Three.js, WebGPU처럼 프레임 단위로 상태가 바뀌는 화면을 위해 추가된 Gaesup-State의 고빈도 상태관리 계층입니다.

일반 UI 상태는 `GaesupCore` store로 충분합니다. 하지만 3D 화면에서는 매 프레임 position, rotation, scale, screen transition, camera transition 같은 값이 바뀝니다. 이 값을 전부 React state로 올리면 reconciliation 비용이 커지고, JSON patch로 많이 넘기면 직렬화 비용이 커집니다.

Render runtime의 목표는 다음입니다.

- 프레임 상태를 Rust WASM store에 둡니다.
- 바뀐 entity만 dirty로 추적합니다.
- JS에는 typed matrix buffer만 넘깁니다.
- R3F 또는 WebGPU buffer에 직접 반영합니다.

## 기본 흐름

```typescript
import { GaesupRender, GaesupRenderBridge } from 'gaesup-state';

await GaesupRender.createStore('scene', 'home');

const cubeId = await GaesupRender.createEntity('scene', {
  instanceIndex: 0,
  transform: {
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1]
  },
  meshId: 'cube',
  materialId: 'default',
  visible: true
});

const bridge = new GaesupRenderBridge({ storeId: 'scene' });

await GaesupRender.rotateY('scene', cubeId, 0.016);
await bridge.tick(16.6);
```

## JSON patch 경로

debug나 일반 object patch에는 JSON patch 경로가 편합니다.

```typescript
const bridge = new GaesupRenderBridge({
  storeId: 'scene',
  patchMode: 'json'
});

const patches = await bridge.tick(16.6);
```

장점은 사람이 읽기 쉽다는 점입니다. 단점은 entity가 많을수록 JS 객체와 number array가 많이 생긴다는 점입니다.

## typed dirty buffer 경로

기본 권장 경로는 typed dirty buffer입니다.

```typescript
const bridge = new GaesupRenderBridge({
  storeId: 'scene',
  patchMode: 'typed'
});

const result = await bridge.tick(16.6);
```

반환되는 dirty buffer는 다음 형태입니다.

```typescript
{
  count: number;
  instanceIndices: Uint32Array;
  matrices: Float32Array;
}
```

`instanceIndices[i]`는 바뀐 instance index이고, `matrices.subarray(i * 16, i * 16 + 16)`은 해당 instance의 4x4 matrix입니다.

## R3F InstancedMesh 연결

`writeDirtyMatrices`를 가진 writer를 bridge에 연결하면 fallback보다 빠릅니다.

```typescript
bridge.bindInstancedWriter({
  writeDirtyMatrices(indices, matrices) {
    for (let i = 0; i < indices.length; i++) {
      const index = indices[i];
      const matrix = matrices.subarray(i * 16, i * 16 + 16);

      // tempMatrix.fromArray(matrix);
      // instancedMesh.setMatrixAt(index, tempMatrix);
    }

    // instancedMesh.instanceMatrix.needsUpdate = true;
  }
});
```

현재 wrapper는 `writeDirtyMatrices`가 없으면 `setMatrixAt` fallback을 사용합니다.

## WebGPU buffer 연결

WebGPU buffer를 직접 넘길 수도 있습니다.

```typescript
const bridge = new GaesupRenderBridge({
  storeId: 'scene',
  gpuDevice: device,
  matrixBuffer,
  matrixStrideBytes: 64,
  gpuWriteMode: 'range'
});

await bridge.tick(16.6);
```

`gpuWriteMode: 'range'`를 쓰면 Rust/WASM render store가 dirty instance를 정렬한 뒤 연속된 index를 하나의 range로 묶습니다. matrix stride가 64 bytes이면 range 하나당 `device.queue.writeBuffer`를 한 번만 호출합니다.

직접 WebGPU 상태 브릿지를 쓰는 경우에는 `GaesupWgpuState`를 사용할 수 있습니다.

```typescript
import { GaesupWgpuState } from 'gaesup-state';

const wgpu = new GaesupWgpuState({
  storeId: 'scene',
  device,
  matrix: {
    buffer: matrixBuffer,
    strideBytes: 64
  }
});

await wgpu.tick(16.6);
```

이 구조에서 상태의 소유자는 Rust/WASM render store이고, WebGPU buffer는 상태를 반영하는 출력 대상입니다. 브라우저 WebGPU 객체 자체는 JS API가 소유하므로 Rust가 `GPUBuffer`를 직접 들고 있지는 않습니다.

## 화면 전환

화면 전환도 render store에 넣을 수 있습니다.

```typescript
await GaesupRender.beginScreenTransition('scene', 'detail', 300, 'ease-out');
await GaesupRender.tickFrameState('scene', 16.6);
```

이렇게 하면 React route state와 render transition state를 분리할 수 있습니다.

## R3F에서 경계를 완전히 안 넘을 수 있나

브라우저에서 R3F와 Three.js를 쓰는 한 JS 경계를 완전히 없애기는 어렵습니다. Three.js object와 WebGPU API는 JS에서 호출해야 합니다.

대신 줄일 수 있는 것은 다음입니다.

- 매 프레임 React state update를 하지 않습니다.
- entity별 JSON patch를 만들지 않습니다.
- dirty matrix만 typed array로 넘깁니다.
- 가능하면 InstancedMesh 또는 GPU buffer에 직접 씁니다.

이 구조라면 “경계를 넘지 않는다”가 아니라 “경계를 작고 예측 가능한 형태로 한 번만 넘는다”에 가깝습니다.

## 현재 한계

- 실제 wgpu native renderer는 아직 포함되어 있지 않습니다.
- 브라우저 WebGPU 호출은 JS API를 거칩니다.
- matrix stride가 64 bytes가 아닌 경우 range batching 대신 matrix별 write fallback을 사용합니다.
- dirty tracking은 더 numeric-friendly한 구조로 개선할 여지가 있습니다.
- async tick을 R3F `useFrame`에서 직접 기다리는 방식은 큰 앱에서 조정이 필요합니다.

## 다음 개선 방향

- numeric entity id와 packed dirty list
- WASM memory view 재사용
- material/uniform buffer dirty range
- worker 기반 render state tick
- R3F hook wrapper
- WebGPU 전용 command buffer
- 실제 wgpu/native host 연동 실험
