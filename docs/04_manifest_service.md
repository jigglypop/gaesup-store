# Manifest 서비스

Manifest는 WASM 패키지가 실행 전에 host에게 제출하는 계약서입니다. 패키지는 자신이 필요한 ABI, dependency, store schema, accelerator, import, permission을 manifest에 적습니다.

## 기본 형태

```typescript
const manifest = {
  manifestVersion: '1.0',
  name: 'orders-widget',
  version: '1.0.0',
  runtime: 'wasm',
  gaesup: {
    abiVersion: '^1.0.0',
    minHostVersion: '0.2.0'
  },
  dependencies: [],
  stores: [],
  accelerators: [],
  allowedImports: [],
  permissions: {}
};
```

## 검증 항목

| 항목 | 설명 |
| --- | --- |
| ABI | host가 패키지 ABI를 지원하는지 확인 |
| dependency | host 제공 버전 또는 bundled 여부 확인 |
| store schema | 공유 store 접근 가능 여부 확인 |
| accelerator | WebGPU/CUDA 같은 실행 경로 제공 여부 확인 |
| imports | WASM import가 허용 목록 안에 있는지 확인 |
| permissions | network, storage 같은 권한 확인 |

## dependency

```typescript
dependencies: [
  { name: 'date-fns', version: '^2.29.0', source: 'host' },
  { name: 'chart.js', version: '^3.9.0', source: 'bundled' }
]
```

`host`는 host가 제공해야 합니다. `bundled`는 패키지 내부에 포함되어 있으므로 host 버전과 충돌하지 않습니다.

## store

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

schema가 맞지 않으면 `conflictPolicy`에 따라 차단하거나 격리합니다.

## 서비스 방향

나중에 manifest service가 별도 서버나 registry로 분리되면 다음 책임을 가질 수 있습니다.

- 패키지 manifest 저장
- signature 검증
- compatibility result 캐싱
- host별 실행 가능 패키지 목록 제공
- 패키지 버전별 migration 정보 제공

현재 저장소에서는 `CompatibilityGuard`가 이 서비스의 핵심 검증 로직을 담당합니다.
