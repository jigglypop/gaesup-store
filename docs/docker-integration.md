# Docker/WASM 패키징

이 문서는 Gaesup-State에서 말하는 “WASM을 컨테이너처럼 쓴다”는 의미를 설명합니다.

중요한 점부터 말하면, 브라우저 안에서 Docker 컨테이너를 그대로 실행한다는 뜻은 아닙니다. 브라우저는 Docker daemon을 실행하지 않습니다. 대신 WASM 패키지를 작은 실행 단위로 보고, Docker 컨테이너처럼 manifest, dependency, permission, store contract, accelerator contract를 선언하고 검증하는 모델입니다.

## 목표

- 패키지가 요구하는 ABI를 실행 전에 확인합니다.
- host dependency와 bundled dependency를 구분합니다.
- store schema가 맞지 않으면 공유 상태 접근을 막습니다.
- CUDA/WebGPU 같은 accelerator 요구사항을 manifest로 검증합니다.
- 패키지가 host dependency graph를 깨지 못하게 합니다.
- 패키지별 권한과 import를 명시합니다.

## manifest 예시

```typescript
const manifest = {
  manifestVersion: '1.0',
  name: 'analytics-widget',
  version: '1.0.0',
  runtime: 'wasm',
  gaesup: {
    abiVersion: '^1.0.0',
    minHostVersion: '0.2.0'
  },
  dependencies: [
    { name: 'date-fns', version: '^2.29.0', source: 'host' },
    { name: 'chart.js', version: '^3.9.0', source: 'bundled' }
  ],
  stores: [
    {
      storeId: 'analytics',
      schemaId: 'analytics-state',
      schemaVersion: '^2.0.0',
      conflictPolicy: 'reject'
    }
  ],
  accelerators: [
    { kind: 'webgpu', version: '>=1.0.0', capabilities: ['shader-f16'] }
  ],
  allowedImports: ['env.memory', 'env.gpu.webgpu'],
  permissions: {
    network: false,
    storage: 'scoped'
  }
};
```

## dependency source

### host

`source: 'host'`는 host가 제공하는 라이브러리를 쓰겠다는 뜻입니다.

```typescript
dependencies: [
  { name: 'date-fns', version: '^2.29.0', source: 'host' }
]
```

host가 `date-fns@2.30.0`을 제공하면 실행 가능합니다. host가 `date-fns@3`만 제공하면 version mismatch로 차단합니다.

### bundled

`source: 'bundled'`는 패키지가 자기 의존성을 함께 들고 온다는 뜻입니다.

```typescript
dependencies: [
  { name: 'chart.js', version: '^3.9.0', source: 'bundled' }
]
```

host가 `chart.js@4.4.3`을 쓰고 있어도 패키지는 내부의 `chart.js@3`으로 실행할 수 있습니다. 이 경우 host dependency graph는 바뀌지 않습니다.

## store contract

패키지가 공유 상태에 접근하려면 store contract가 맞아야 합니다.

```typescript
stores: [
  {
    storeId: 'orders',
    schemaId: 'orders-state',
    schemaVersion: '^1.2.0',
    conflictPolicy: 'reject'
  }
]
```

host가 등록한 store:

```typescript
{
  storeId: 'orders',
  schemaId: 'orders-state',
  schemaVersion: '1.2.0'
}
```

이 경우 공유 store에 붙을 수 있습니다.

만약 패키지가 `orders-state@^2.0.0`을 요구한다면 host의 `1.2.0`과 맞지 않습니다. 이때 `conflictPolicy`가 `reject`면 차단하고, `isolate`면 격리 store namespace를 줍니다.

## accelerator contract

accelerator는 패키지가 CPU 외 실행 경로를 요구할 때 씁니다.

```typescript
accelerators: [
  { kind: 'cuda', version: '>=12.0.0', capabilities: ['sm_80', 'tensor-cores'] },
  { kind: 'webgpu', version: '>=1.0.0', capabilities: ['shader-f16'] }
]
```

정리하면 다음과 같습니다.

| kind | 의미 |
| --- | --- |
| `cpu` | 기본 실행 경로 |
| `webgpu` | 브라우저 또는 host가 WebGPU 경로를 제공해야 함 |
| `cuda` | host/runtime이 CUDA 실행 경로를 제공해야 함 |

CUDA는 일반 브라우저 JS가 직접 실행하는 기능이 아닙니다. Electron, local agent, server runtime, native host 같은 외부 실행 계층이 CUDA 기능을 제공하고, Gaesup-State는 그 계약을 검증하는 모델로 봅니다.

## Containerfile 스타일 예시

실제 Dockerfile을 그대로 쓰는 것은 아니지만, 패키징 선언은 Dockerfile과 비슷한 형태로 표현할 수 있습니다.

```dockerfile
FROM scratch
ABI 1.0

DEPENDENCY date-fns ^2.29.0 host
DEPENDENCY chart.js ^3.9.0 bundled

STORE analytics analytics-state ^2.0.0 reject

ACCELERATOR webgpu >=1.0.0 shader-f16

IMPORT env.memory
IMPORT env.gpu.webgpu

PERMISSION network false
PERMISSION storage scoped
```

이 선언을 manifest JSON으로 변환한 뒤 `CompatibilityGuard`가 검증합니다.

## 실행 결정 예시

host 계약:

```typescript
const host = {
  abiVersion: '1.0.0',
  defaultConflictPolicy: 'reject',
  dependencies: [
    { name: 'date-fns', version: '2.30.0' },
    { name: 'zod', version: '3.23.8' },
    { name: 'chart.js', version: '4.4.3' }
  ],
  stores: [
    { storeId: 'orders', schemaId: 'orders-state', schemaVersion: '1.2.0' },
    { storeId: 'analytics', schemaId: 'analytics-state', schemaVersion: '2.1.0' }
  ]
};
```

결과 예시:

| 패키지 | 결과 | 이유 |
| --- | --- | --- |
| `orders-widget` | Runs shared | `date-fns`와 `orders` schema가 host와 맞음 |
| `legacy-report` | Runs packaged | `chart.js@3`을 bundled로 들고 와 host `chart.js@4`와 충돌하지 않음 |
| `experimental-checkout` | Runs isolated | dependency는 맞지만 `orders-state@2`를 요구해 공유 store 대신 격리 |
| `unsafe-host-plugin` | Blocked | `chart.js@3`을 host에서 요구하지만 host는 `chart.js@4`만 제공 |

이 모델이 중요한 이유는 “실행은 되지만 상태는 깨지는” 상황을 줄이기 위해서입니다. 의존성은 패키지 안으로 격리할 수 있지만, 공유 store는 schema가 맞을 때만 연결해야 합니다.

## 보안과 격리 한계

현재 문서의 “컨테이너”는 격리 정책 모델입니다. OS 수준 namespace, cgroup, seccomp 같은 Docker 격리를 브라우저에서 그대로 제공하지 않습니다.

실제 강한 격리를 원하면 다음이 필요합니다.

- WASM import whitelist enforcement
- capability 기반 host function 제공
- package signature 검증
- CSP와 iframe/worker 격리
- storage namespace 분리
- network 권한 enforcement
- native host 또는 server runtime의 sandbox

Gaesup-State의 현재 1차 목표는 dependency와 store contract를 먼저 방어하는 것입니다. 보안 sandbox는 이 모델 위에 단계적으로 얹어야 합니다.
