# 운영 배포 준비도

현재 Gaesup-State는 Rust/WASM core, TypeScript wrapper, auto store, resource/query, dispatch pipeline, render fast path, dependency/store/deployment guard까지 기본 축은 잡혀 있습니다. 하지만 운영으로 올리려면 아래 항목이 더 필요합니다.

## 아직 부족한 점

### 1. 패키지 무결성 검증

지금은 manifest 내용이 맞는지 검증하지만, manifest와 WASM binary가 같은 산출물인지까지 강하게 증명하지는 않습니다.

운영에서는 다음 값이 필요합니다.

- WASM binary sha256
- manifest sha256
- package tarball sha256
- Git commit SHA
- build provenance
- 서명된 release manifest

권장 구조:

```json
{
  "releaseId": "web-2026-04-28.1",
  "gitSha": "abc1234",
  "artifacts": [
    {
      "slot": "body",
      "packageName": "@shop/body",
      "version": "1.8.0",
      "manifestSha256": "...",
      "wasmSha256": "..."
    }
  ]
}
```

### 2. Manifest registry

지금은 앱 안에서 manifest를 직접 들고 검증하는 예제가 중심입니다. 운영에서는 manifest service 또는 registry가 있어야 합니다.

registry의 책임:

- slot별 manifest 저장
- release별 slot 조합 저장
- 이전 release 조회
- rollback 대상 조회
- 호환성 검증 결과 캐싱
- 서명과 hash 검증

### 3. Rollback 정책

WASM 컨테이너를 조각별로 배포하면 rollback도 조각별로 하고 싶어집니다. 하지만 contract가 엮이면 조각 하나만 되돌릴 수 없는 경우가 있습니다.

필요한 정책:

- release 단위 rollback
- slot 단위 rollback 가능 여부 검사
- store schema migration rollback
- incompatible slot 발견 시 fallback slot 렌더링

### 4. Store migration

지금은 schema가 맞지 않으면 `reject` 또는 `isolate`가 핵심입니다. 운영에서는 schema를 바꾸는 배포가 반드시 나옵니다.

추가해야 할 것:

- schema migration manifest
- forward migration
- rollback migration
- readonly migration window
- migration dry-run

### 5. 보안 sandbox

현재 모델은 dependency와 store contract를 방어하는 쪽에 가깝습니다. 강한 보안 격리까지 가려면 별도 장치가 필요합니다.

필요한 것:

- WASM import whitelist enforcement
- capability 기반 host function 제공
- network/storage 권한 적용
- CSP, Worker, iframe 격리 전략
- native host 또는 server runtime에서의 sandbox 정책

### 6. CI 재현성

운영 배포 전 CI에서 같은 commit이 같은 산출물을 만드는지 확인해야 합니다.

최소 CI 단계:

- Rust unit test
- TypeScript test
- type-check
- WASM build
- package dry-run
- monorepo container manifest validation
- npm smoke install

### 7. 관측성

운영에서 막힌 manifest는 원인을 바로 알아야 합니다.

남겨야 할 이벤트:

- validation error code
- package name/version
- releaseId
- slot
- store schema mismatch
- dependency mismatch
- isolated store namespace
- fallback 여부

## 운영 전 최소 체크리스트

| 항목 | 현재 상태 | 운영 전 필요 |
| --- | --- | --- |
| Rust/WASM core | 있음 | CI에서 항상 빌드 |
| TS wrapper | 있음 | npm smoke 유지 |
| dependency guard | 있음 | registry manifest와 연결 |
| store schema guard | 있음 | migration 전략 추가 |
| deployment guard | 있음 | release manifest hash 추가 |
| render fast path | 있음 | 실제 R3F/WebGPU 예제 추가 |
| npm 배포 | 0.0.1 배포됨 | release 자동화 |
| GitHub CI | 추가 필요 | PR gate로 고정 |
| 보안 sandbox | 설계 단계 | import/capability enforcement |

## 지금 운영에 올린다면

작은 내부 서비스나 실험용 dashboard에는 올릴 수 있습니다. 다만 외부 사용자가 많은 서비스의 핵심 화면에 바로 넣기에는 아직 이릅니다.

추천 순서:

1. 내부 페이지에서 `gaesup` auto store와 dependency guard를 먼저 사용합니다.
2. WASM 컨테이너는 read-only widget부터 붙입니다.
3. store schema가 필요한 컨테이너는 `reject` 정책으로만 시작합니다.
4. releaseId와 deployment guard를 CI에 묶습니다.
5. registry와 rollback을 만든 뒤 write 권한이 있는 컨테이너를 엽니다.
