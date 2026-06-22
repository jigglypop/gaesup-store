# Gaesup 구현 완료 목표

이 문서는 Gaesup을 **부분 배포 프론트엔드 컨테이너를 위한 WASM 기반 상태 계약 런타임**으로 완성하기 위한 변경 체크 문서다.

각 항목은 구현, 테스트, 문서 동기화가 끝났을 때만 완료로 표시한다.

## 완료 정의

- 컨테이너 artifact는 검증 전에는 실행되지 않는다.
- `allowedImports`, `permissions`, store schema policy는 런타임에서 강제된다.
- Rust store dispatch는 변경 path metadata를 제공한다.
- Framework adapter는 공통 lifecycle contract를 따른다.
- Machine transition은 observable하고 rollback 가능하다.
- Partial deployment workflow는 changed container detection, validation, artifact upload, registry slot update, rollback pointer update를 포함한다.
- Operator는 실패 원인을 stable error code와 runtime timeline에서 확인할 수 있다.

## 구현 체크리스트

### Container Runtime

- [ ] 외부 `.wasm` artifact 로드와 인스턴스화
- [x] artifact sha256 검증
- [x] signature 검증
- [x] `allowedImports` fail-closed 강제
- [x] capability registry를 통한 host function 주입
- [x] Worker 또는 iframe isolation
- [ ] container memory/storage/event/network access 분리
- [x] denied capability audit event

### Permission Policy

- [x] network allowlist 강제
- [x] storage namespace isolation
- [x] effect permission 강제
- [x] runtime audit log
- [x] CSP guidance 문서화

### Store Schema Policy

- [x] `reject`
- [x] `isolate`
- [ ] `migrate` attach-before-migration runtime enforcement
- [x] `readonly`
- [x] `shadow`
- [x] `dual-write`
- [x] policy별 validator test
- [x] runtime write/read policy enforcement

### Store Performance / Invalidation

- [x] Rust dispatch changed-path metadata
- [x] path-level subscriber notification
- [ ] selector/path invalidation adapter 연동
- [x] JSON vs batch vs typed vs machine benchmark runner

### Framework Adapter Contract

- [x] 공통 contract: `mount`
- [x] 공통 contract: `unmount`
- [x] 공통 contract: `subscribe`
- [x] 공통 contract: `dispatch`
- [x] 공통 contract: `getSnapshot`
- [x] 공통 contract: `onError`
- [x] repeated mount/unmount cleanup test
- [x] failed mount behavior test
- [x] isolated store fallback test

### Machine Runtime

- [ ] flat finite states
- [ ] event transitions
- [ ] named guards
- [ ] assign/context updates
- [ ] entry/exit/action descriptors
- [ ] final states
- [ ] snapshots
- [ ] step history
- [ ] rollback
- [x] effect permission enforcement
- [x] store metrics / DevTools timeline 연동
- [x] TS wrapper integration tests

### Observability

- [x] runtime timeline
- [x] manifest validation result reporting
- [x] container lifecycle metrics
- [x] store transition metrics
- [x] machine transition logs
- [x] `GaesupCore.getRuntimeMetrics()`
- [x] DevTools bridge container/store/machine context

### Partial Deployment CI/CD

- [x] changed container detection
- [x] affected manifest validation
- [x] affected artifact build
- [x] artifact upload
- [x] registry slot pointer update
- [x] compatibility failure deployment block
- [x] rollback script

### Verification Surface

- [x] root test scripts do not reference missing files
- [x] benchmark runner exists
- [x] Playwright config exists or e2e script is corrected
- [ ] Rust unit tests pass
- [ ] Rust doctest issue is handled
- [ ] Core TS tests pass without local OOM surprises

## 반복 체크 로그

### 2026-06-18 초기 작성

- 완료 목표 문서를 추가했다.
- 다음 단계는 코드 계약 재확인 후 구현 항목을 작은 단위로 적용하는 것이다.

### 2026-06-18 1차 구현 체크

- Rust store에 `dispatch_with_metadata`와 changed-path subscriber filtering을 추가했다.
- Store schema validator가 `migrate`, `readonly`, `shadow`, `dual-write` 정책을 인식하고 테스트한다.
- Adapter 공통 contract와 cleanup/error 테스트를 추가했다.
- Core runtime timeline, `GaesupCore.getRuntimeMetrics()`, DevTools bridge event 기록을 추가했다.
- Machine effect permission과 transition timeline 기록을 추가했다.
- TS micro-sandbox worker에 network/storage permission fail-closed 처리를 추가했다.
- Partial deployment registry update와 rollback script를 추가하고 workflow placeholder를 제거했다.
- Benchmark runner와 Playwright config를 추가했다.
- 남은 주요 작업은 signature 검증, host capability registry 일반화, 실제 artifact build, TS wrapper integration test, Rust/TS 로컬 OOM 검증 안정화다.

검증:

- `node --max-old-space-size=4096 ./node_modules/typescript/bin/tsc --noEmit -p packages/core/tsconfig.json` 통과.

### 2026-06-22 3차 구현 체크

- `GaesupCore.setStoreRuntimePolicy()`와 `clearStoreRuntimePolicy()`를 추가했다.
- `readonly` store write를 런타임에서 차단하고 `STORE_READONLY_WRITE_DENIED` timeline event를 남긴다.
- `shadow`/`isolate` policy가 read/write를 shadow store로 라우팅한다.
- `dual-write` policy가 보조 store에도 mutation을 복제한다.
- Adapter mount에 `fallbackContainer`를 추가해 primary mount 실패 시 isolated fallback을 사용할 수 있게 했다.
- Machine TS wrapper 통합 테스트에 effect permission denied와 timeline 기록 검증을 추가했다.

검증:

- `node --max-old-space-size=4096 ./node_modules/vitest/vitest.mjs run packages/adapter/src/AdapterContract.test.ts` 통과.
- `node --max-old-space-size=4096 ./node_modules/vitest/vitest.mjs run packages/core/src/auto-store.test.ts -t "store runtime policies|machine actor API"` 통과.
- `node --max-old-space-size=4096 ./node_modules/typescript/bin/tsc --noEmit -p packages/core/tsconfig.json` 통과.
- `node --max-old-space-size=4096 ./node_modules/typescript/bin/tsc --noEmit -p packages/adapter/tsconfig.json` 통과.
- `node --max-old-space-size=4096 ./node_modules/typescript/bin/tsc --noEmit -p packages/adapter/tsconfig.json` 통과.
- `pnpm --filter @gaesup-state/adapter run test -- run src/AdapterContract.test.ts` 통과.
- `pnpm --filter @gaesup-example/monorepo-containers run deploy:affected -- --containers '[body]'` 통과.
- `cargo test --manifest-path packages/core-rust/Cargo.toml --lib`는 현재 Windows rustc/toolchain 메모리/ICE 문제로 완료하지 못했다. 프로덕션 코드 오류와 분리해서 재검증이 필요하다.

### 2026-06-18 2차 구현 체크

- Artifact signature 검증 타입과 `verifyArtifactSignature()`를 추가했다.
- Micro sandbox에 JSON 기반 capability registry를 연결했다.
- Network capability가 permission과 allowlist 없이 실행되지 않도록 fail-closed 처리를 보강했다.
- 보안/격리 문서를 정상 한국어로 교체하고 CSP guidance를 추가했다.

검증:

- `node --max-old-space-size=4096 ./node_modules/typescript/bin/tsc --noEmit -p packages/core/tsconfig.json` 통과.
