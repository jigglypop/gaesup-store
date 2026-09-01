# AGENTS.md — Gaesup 공용 에이전트 원칙

이 파일은 이 저장소에서 작업하는 **모든 코딩 에이전트(Claude Code, Codex 등)의 단일 진실 공급원**이다.
도구별 부가 설정: Claude Code → `CLAUDE.md` + `.claude/`, Codex → `.codex/`.
라운드 오케스트레이션은 `.claude/ARCHITECTURE.md`, 작업 저널은 `HARNESS.md`를 따른다.

## 1. 프로젝트 정체성

Gaesup은 단순 상태 관리 라이브러리가 아니라 **프론트엔드 마이크로 컨테이너 런타임 + 통합 State Plane 라이브러리 코어**다.
규범 스펙은 `docs/runtime-spec-v0.1.md`(§ 번호로 인용)이며, 테스트 주석과 라운드 계약이 이 § 번호를 참조한다.

핵심 축: reactive graph(state/derived/resource/stream/command/transaction), container runtime
(lifecycle/expose/consume/failure isolation), manifest validation(fail-closed), framework adapters, observability.

## 2. 패키지 지형 — 두 세대가 공존한다

### 2세대 (Runtime Spec v0.1 재작성, `@gaesup/*`) — 현재 R1 라운드 대상, 전부 스텁

| 경로 | npm | 상태 |
|---|---|---|
| `packages/gaesup-core` | `@gaesup/core` | `src/index.ts = export {}`. 빨간 테스트(batch, lifecycle) 존재 |
| `packages/gaesup-store` | `@gaesup/store` | 스텁. 빨간 테스트(state, derived) 존재 |
| `packages/gaesup-runtime` | `@gaesup/runtime` | 스텁, 테스트 없음 |
| `packages/gaesup-react` | `@gaesup/react` | 스텁, 테스트 없음 |

⚠️ 이 4개는 아직 `pnpm install`이 안 된 상태일 수 있다 (`node_modules/@gaesup/` 부재 시 테스트가 import 해석부터 실패).
작업 전 `pnpm install` 필요 여부를 확인하라.

### 1세대 (출시 계열, `gaesup-state` / `@gaesup-state/*`) — 보존, 그래프 plane의 현재 구현체

| 경로 | npm | 내용 |
|---|---|---|
| `packages/core` | `gaesup-state` | 실질 코어. ① WASM 파사드(`index.ts`: GaesupCore, CompatibilityGuard, ContainerManager, auto-store, machine) ② **순수 JS reactive graph** (`graph*.ts`: state/derived/batch/transaction/scheduler/snapshot, runtime, mesh, resource, stream, command, persist — cycle 6~15 산출물) ③ sandbox 격리(`micro-sandbox.ts`, `sandbox-orchestrator.ts`) |
| `packages/core-rust` | `gaesup-state-core-rust` | Rust/WASM: store, container, machine, render, **compatibility.rs(manifest validator, fail-closed)**. wasm-pack 3타깃 빌드 |
| `packages/adapter` | `@gaesup-state/adapter` | 프레임워크 공통 어댑터 계약 |
| `packages/frameworks/{react,vue,svelte,angular}` | `@gaesup-state/<fw>` | 어댑터. react만 테스트 보유 |
| `packages/registry` | `@gaesup-state/registry` | private, **워크스페이스 제외** (`!packages/registry`) |

기타: `examples/monorepo-containers`(배포 가드 하네스, CI가 실행), `examples/multi-framework-demo`,
`tests/integration/`(루트 유일 통합 테스트), `benchmarks/`, `tools/container-builder`.

## 3. 최우선 방향

1. **Fail closed**: 컨테이너는 로드된다고 신뢰하지 않는다. hash/signature, ABI, schema, permission,
   import, deployment slot 계약을 통과한 뒤에만 attach. allowlist가 없으면 deny가 기본.
   애매하면 허용하지 않는다. 실패는 조용히 무시하지 않고 stable error code + audit/trace 이벤트를 남긴다.
2. **선언은 강제로**: manifest 필드(`permissions`, `allowedImports`, store schema policy)는 문서가 아니라
   실제 런타임 정책으로 강제한다.
3. **코어는 프레임워크를 모른다**: `@gaesup/core·store·runtime`(그리고 `packages/core`의 graph plane)에
   react/DOM 의존 금지 (스펙 I8). 어댑터는 얇게, lifecycle 계약은 강하게.
4. **WASM 경계**: WASM은 hot path·결정론적 전이에만. side effect는 WASM에서 직접 실행하지 않는다 —
   effect descriptor를 반환하고 JS host가 permission check 후 실행. 큰 JSON을 JS/WASM 경계로 반복 이동 금지.
5. **KISS/DRY/작은 변경**: 가장 단순한 동작 구현 먼저. 추상화는 실제 중복(3곳 이상)을 줄일 때만.
   같은 검증 로직을 Rust/TS/script에 중복 산포 금지. 에러 코드·이벤트 이름은 한 곳의 계약 기준.
   요청 범위 밖 리팩터·포맷 대량 변경·파일 이동 연쇄 금지.

## 4. 명명·코드 규약 (실측 기준)

- **에러 코드**: SCREAMING_SNAKE 문자열 리터럴.
  - graph plane: `GAESUP_` 접두 + 모듈별 `<Name>ErrorCode` union + `.code`를 갖는 `<Name>Error extends Error`
    (예: `GAESUP_DEPENDENCY_CYCLE`, `GAESUP_INVALID_TRANSITION`).
  - 1세대 런타임/정책: 접두 없는 도메인 코드 (`STORE_SCHEMA_CONFLICT`, `EFFECT_PERMISSION_DENIED`, …).
  - Rust validator: `validation_issue(code, …)` 경유 (`ABI_VERSION_MISMATCH`, `MANIFEST_HASH_INVALID`, …).
  - 새 코드는 기존 계열에 맞춘다. 새 계열 신설 금지.
- **이벤트 이름**: `namespace:verb-과거형(kebab)` — `manifest:validated`, `store:conflict-rejected`,
  `deployment:rolled-back`. graph trace만 예외적으로 `state-change` | `derived-recompute` 스타일.
- **TypeScript**: 루트 `tsconfig.json`은 최고 강도(strict + noUnused* + exactOptionalPropertyTypes +
  noImplicitReturns/Override). `packages/gaesup-*`는 루트를 extend하므로 이 강도를 그대로 받는다.
  `packages/core`는 독립 tsconfig(더 느슨). 새 코드는 루트 강도 기준으로 작성.
- **테스트**: vitest, 패키지 내 `src/*.test.ts(x)` **동일 위치 배치** (`__tests__` 디렉터리 금지).
  vitest 설정 파일 없음(기본값 사용).
  - `packages/core`: `describe('<module>')` + 영어 행동 서술 `it('registers as CREATED and walks to ACTIVE on start')`.
  - `packages/gaesup-*`: `it('test_<snake_case>')` + 스펙 § 인용 한국어 주석.
  - Rust: `#[cfg(test)] mod tests` + `#[test] fn snake_case_행동서술()` + `serde_json::json!` fixture,
    `errors[0]["code"]` assert. **네이티브 cargo test** — wasm-pack 브라우저 테스트 신설 금지.
  - 성공 케이스만 만들지 않는다 — fail-closed 케이스가 본체. fake/mock은 이름에 fake임이 드러나게
    (`DemoContainerManager` vs `MicroSandboxRuntime` 경계 혼동 금지).
- **언어**: 문서·주석·에이전트 파일은 한국어, 식별자·에러 코드는 영어.

## 5. 검증 명령 — 이것만 신뢰하라 (CI와 동일)

```bash
cargo check --manifest-path packages/core-rust/Cargo.toml
cargo test  --manifest-path packages/core-rust/Cargo.toml
pnpm --filter gaesup-state run type-check
pnpm --filter gaesup-state run test
pnpm --filter gaesup-state run build
pnpm --filter @gaesup/core run test          # (2세대, install 후) store/runtime/react 동일 패턴
pnpm --filter @gaesup/core run type-check
pnpm run example:monorepo                    # 배포 가드 fixture 검증
pnpm run bench:runtime                       # 성능 민감 라운드에서만
pnpm run npm:check                           # 배포 전 종합
```

### 쓰지 말 것 (알려진 지뢰)

- `pnpm -r run test` / `pnpm -r run type-check` — 실패한다. vue/svelte/angular는 테스트 파일 0개로
  vitest가 비정상 종료하고, `@gaesup-state/react`는 존재하지 않는 `./hooks/useRuntimeMetrics` re-export로
  type-check가 깨져 있으며(사전 존재 실패 — 라운드 계약 없이 손대지 말 것), gaesup-* 스텁은 미설치 상태일 수 있다.
- `pnpm run lint` — ESLint 설정 파일이 저장소에 없다. lint는 비기능 상태.
- `pnpm run test:e2e` — playwright testMatch(`*.e2e.ts`/`*.spec.ts`)에 걸리는 파일이 없다.
- `pnpm run docker:up` — compose 파일은 루트가 아니라 `docker/docker-compose.wasm.yml`에 있다.
- `wasm-pack test --chrome` — CI도 쓰지 않는다. Rust 검증은 네이티브 `cargo test`.
- `tests/integration/multi-framework.test.ts` — 존재하지 않는 `gaesup-state/immer` 등 서브패스를 import(사전 존재 실패).

메모리 주의: core·adapter·gaesup-* 패키지 스크립트는 `node --max-old-space-size=4096 ../../node_modules/...`
경유 실행이 확립된 패턴이다. 새 스크립트도 이 패턴을 유지하라.

## 6. 하네스 규칙 (요약)

- 작업 단위는 **라운드** = 계약 1개. 계약(YAML)이 유일한 작업 명세 — 계약에 없는 것은 하지 않는다.
  계약 `packages` allowlist 밖 파일 수정 = 실패. 상태 기계·게이트(G0~G6)는 `.claude/ARCHITECTURE.md`.
- **게이트 판정은 명령의 exit code만 믿는다.** 에이전트의 "통과했다" 보고는 판정에 쓰지 않는다.
- 사전 존재 실패(이번 diff와 무관한 기존 실패)는 별도 표기하고 손대지 않는다.
- 테스트를 구현에 맞게 완화하지 않는다. 빨간 테스트가 틀렸다고 판단되면 고치지 말고 보고.
- 라운드 결과는 `HARNESS.md` 저널(6단계 주기 목록)에 기록한다. 기록은 확정 사실만.
- **커밋은 사용자 승인 후에만.** lockfile·설정 파일 무단 변경 금지. 신규 의존성은 계약의
  `allowed_new_deps`에 명시된 것만.

### 알려진 계약 드리프트 (다음 라운드에서 해소할 것)

R1 계약(`.claude/rounds/R1-mvp-0.1.yaml`)의 에러 코드와 `packages/core` graph plane의 기구현 코드가 다르다:
계약 `GAESUP_DUPLICATE_CONTAINER`/`GAESUP_CONSUME_NOT_EXPOSED`/`GAESUP_READONLY_NODE` ↔
구현 `GAESUP_CONTAINER_ALREADY_REGISTERED`/`GAESUP_DEPENDENCY_UNAVAILABLE`/`GAESUP_EXPOSE_CONFLICT`.
2세대 이식 시 어느 쪽을 규범으로 삼을지 계약 단계(CONTRACT)에서 확정하고 한쪽으로 통일하라.
