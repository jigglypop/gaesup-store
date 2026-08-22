# Gaesup-State 하네스 아키텍처 — 검증 게이트형 Evaluator–Optimizer

> 상태: v1 적용 완료 (2026-08-13). 로스터: `.claude/agents/{dev,verifier,test-writer,slim,scribe}.md`,
> 실행 스킬: `.claude/skills/round/SKILL.md`. (구 sigmensa용 ORCHESTRATION.md·agents·
> harness 스킬은 이 레포와 무관해 삭제됨.)

## 0. 이론 선택과 근거

채택 아키텍처: **Evaluator–Optimizer 루프** (Anthropic, *Building Effective Agents*)를
**orchestrator–workers + 적대적 검증** (Anthropic, *Multi-Agent Research System*)으로
경화한 형태. 핵심 원리 두 가지:

1. **Generator–Verifier 비대칭**: 산출물을 만드는 것보다 검증하는 것이 싸고 정확하다.
   따라서 지능(토큰)은 생성이 아니라 검증에 집중 투자한다. 검증자는 생성자와
   컨텍스트를 공유하지 않는 독립 에이전트여야 한다(자기 산출물에 대한 확증 편향 차단).
2. **결정론적 제어 평면 + 확률적 실행 평면**: 라운드의 상태 전이·게이트 판정은
   스크립트/명령(결정론)이 하고, 코드 생성·판단(확률)만 에이전트가 한다.
   에이전트의 "통과했다"는 보고는 신뢰하지 않는다 — 게이트 명령의 exit code만 믿는다.

**이 레포에 이 이론을 고른 이유 — 런타임과 하네스의 구조적 대칭.**
Gaesup 런타임은 컨테이너를 신뢰하지 않고 attach 전에 manifest/ABI/schema/permission
계약을 fail-closed로 강제한다(AGENTS.md 최우선 방향 1). 하네스도 동일하게:
**에이전트 산출물(diff)은 컨테이너다. 게이트를 통과하기 전에는 merge(커밋)되지 않는다.**

| 런타임 개념 | 하네스 개념 |
|---|---|
| Container manifest | 라운드 계약(Round Contract) |
| Validator (Rust, fail-closed) | 게이트 G0–G6 (결정론적 명령) |
| CompatibilityGuard 적대 검사 | verifier 에이전트 (반증 지향, 읽기 전용) |
| Audit event / timeline | HARNESS.md 라운드 저널 (append/REPLACE) |
| Snapshot / rollback | git (게이트 실패 시 diff 폐기 가능) |
| allowlist 없으면 deny | 계약에 선언 안 된 파일 변경 = G0 실패 |

## 1. 라운드 상태 기계

라운드 = HARNESS.md의 "주기" 1개 = 계약 1개. 상태 전이는 오케스트레이터(메인 세션)가
집행하되, 전이 조건은 전부 게이트 명령의 exit code다.

```
CONTRACT ──> SKELETON ──> IMPLEMENT ──> GATES ──┬─ pass ─> VERIFY ──┬─ 승인 ─> QUALITY ─> RECORD
 (계약 확정)  (테스트 우선)  (dev 에이전트)  (G0–G4)  │                │
                                                └─ fail ────────────┴─ 반증 ──> IMPLEMENT (r+1)
                                                        r < R_max(=3)일 때만. 초과 시 HALT(사용자 에스컬레이션)
QUALITY ─> RECORD (G5–G6) ─> 커밋(사용자 승인) ─> 다음 라운드
```

- **fail-closed 전이**: GATES 실패·VERIFY 반증 시 유일한 전이는 IMPLEMENT 재진입 또는
  HALT. "일부만 통과했으니 넘어가자"는 전이는 존재하지 않는다.
- **HALT 조건**: 재시도 3회 초과, 계약 자체 모순 발견, 선언 범위 밖 변경 필요 판명.
  HALT 시 오케스트레이터는 diff를 폐기하지 않고 현황 보고 후 사용자 판단을 기다린다.

### 라운드 계약 스키마 (프롬프트에 그대로 실림)

```yaml
round: "5주기: machine metrics"          # HARNESS.md 주기명과 일치
goal: "get_machine_metrics 순수 집계 API"
packages: [core-rust, core]              # G0 allowlist — 이 밖의 변경은 실패
error_codes: []                          # 신규 에러 코드 (G3 감사 대상)
audit_events: []                         # 신규/검증 대상 audit 이벤트 (G3)
api_surface:                             # 신규 public API 시그니처 (Rust + TS)
  - "get_machine_metrics(id) -> MachineMetrics { transitions, rejected, rollbacks, historyTruncated }"
fail_paths:                              # fail-closed 테스트 필수 목록 (최소 1개)
  - "미존재 machine id -> MACHINE_NOT_FOUND"
bench_sensitive: false                   # true면 G4 필수
docs: [docs/machine-runtime.md]          # G5 갱신 대상
forbidden: ["packages/core/src/micro-sandbox.ts 의 allowlist 의미 변경"]
```

## 2. 게이트 정의 (결정론적 제어 평면)

전부 이 레포에서 실측 가능한 명령. 게이트는 오케스트레이터가 직접 실행한다
(에이전트 보고 재신뢰 금지). ✅ = exit 0.

| 게이트 | 판정 | 명령 | 실패 시 |
|---|---|---|---|
| **G0 범위** | diff가 계약 `packages` 안에만 존재, lockfile/설정 무단 변경 없음 | `git diff --stat` + `git status --short` 를 계약과 대조 | dev 재실행(범위 축소 지시) 또는 계약 개정 후 재시작 |
| **G1 정적** | 타입/컴파일 클린 | `cargo check --manifest-path packages/core-rust/Cargo.toml` · `pnpm --filter gaesup-state run type-check` | dev 재실행 |
| **G2 테스트** | 신규+기존 전부 green, **skip 0** | `cargo test --manifest-path packages/core-rust/Cargo.toml` · `pnpm --filter gaesup-state run test` | dev 재실행 (r+1) |
| **G3 계약 감사** | 계약의 error_code·audit_event가 4중 존재: ① Rust 소스 ② TS 표면 ③ 테스트 assertion ④ fail_paths 각각에 거부 테스트 | `grep -rn "<CODE>" packages/core-rust/src packages/core/src` — 4곳 모두 hit 필요 | test-writer 투입 (구현 갭이면 dev) |
| **G4 벤치** (bench_sensitive時) | 기준선 대비 회귀 없음 | `pnpm run bench:runtime` (기준선: 직전 라운드 기록치) | 원인 분석 후 dev 또는 계약 개정. 측정 없는 "최적화" 주장 금지 |
| **G5 저널·문서** | HARNESS.md 라운드 기록 + 계약 `docs` 갱신 | scribe 산출 diff 확인 | scribe 재실행 |
| **G6 회귀** | 커밋 직전 전체 1회 | G1+G2 전체 재실행 (선별 실행은 IMPLEMENT 중에만 허용) | 커밋 보류 |

게이트 판정에 대한 금지 사항 (AGENTS.md 금지 목록의 하네스 버전):
- ❌ 에이전트의 "테스트 통과" 보고를 게이트 통과로 간주
- ❌ flaky 통과를 위해 assertion 완화 (원인 격리가 유일한 경로)
- ❌ 사전 존재 실패를 이번 라운드 실패로 오인 — 라운드 시작 시 **기준선 게이트 실행**으로
  사전 실패를 먼저 기록하고, 게이트 판정에서 제외 목록으로 명시 관리

## 3. 에이전트 로스터 (확률적 실행 평면)

sigmensa 로스터 폐기, 이 레포 전용 5종. 메인 세션이 오케스트레이터를 겸한다
(단일 모노레포에서 별도 orchestrator 에이전트는 콜드 스타트 세금만 추가).

| 에이전트 | 역할 | 쓰기 | 모델 | 핵심 제약 |
|---|---|---|---|---|
| `dev` | 계약 구현 (Rust/TS/adapter) | O | inherit | 계약 `packages` 밖 수정 금지, 커밋 금지, 신규 의존성 금지 |
| `verifier` | 적대적 검수 | **X (읽기 전용)** | **opus** | 산출 = 판정 JSON only. 반증 지향 프롬프트 고정 |
| `test-writer` | fail_paths·신규 분기 커버 | O (테스트만) | sonnet | Rust native test + vitest. 구현 코드 수정 금지 |
| `slim` | 무동작변경 개선 | O | sonnet | G2 green 유지가 정의 조건. public API 변경 금지 |
| `scribe` | docs·HARNESS.md 저널 | O (문서만) | sonnet | REPLACE 규칙: 설계 뒤집힘 시 섹션 교체, 모순 두 벌 금지 |

**모델 배치 원리 (Generator–Verifier 비대칭의 직접 적용)**: 가장 강한 모델은
verifier에 배치한다. 산출이 판정 JSON뿐이라 토큰이 적고, 읽기 전용이라 강한 모델이
코드를 훼손할 경로가 없으며, 마지막 방어선의 오판이 가장 비싸다.

### verifier 프롬프트 계약 (고정 골격)

```
너의 임무는 이 diff를 통과시키는 것이 아니라 **반증**하는 것이다.
입력: 라운드 계약 전문 + `git diff` 범위.
다음 순서로 공격하라:
1. 계약 위반: api_surface와 실제 시그니처 불일치? fail_paths 중 테스트 안 된 것?
2. fail-closed 구멍: 애매할 때 허용으로 빠지는 경로? silent fail? audit 누락?
3. 경계 위반: WASM에서 side effect 직접 실행? 큰 JSON의 JS/WASM 경계 반복 이동?
   fake/mock이 실제 runtime처럼 포장된 곳?
4. 회귀 위험: 기존 계약(HARNESS.md 1~4주기 기록)과의 충돌.
확신이 없으면 반증 쪽으로 판정하라(fail-closed).
출력(JSON only): {verdict: approve|refute, findings: [{severity, file, line, claim, evidence}]}
evidence 없는 finding은 쓰지 마라 — 각 claim은 파일:줄 또는 실행 명령 결과로 뒷받침.
```

**에스컬레이션 티어**: 보안·격리 계약을 건드리는 라운드(permission, allowedImports,
integrity, sandbox)는 verifier 1명 대신 **Workflow 기반 3-반증자 다수결**
(correctness / fail-closed / 경계 위반, 렌즈 분리)로 승격. 2/3 반증 시 refute.

## 4. 오케스트레이터 규칙 (메인 세션)

1. **계약이 먼저 존재한다.** CONTRACT 상태에서 위 스키마를 채워 사용자에게 제시,
   확정 후에만 SKELETON 진입. 계약 없는 구현 위임 금지.
2. **프롬프트 자기완결**: 워커는 대화를 못 본다. 계약 전문 + 대상 파일 경로 +
   HARNESS.md **섹션 지정**(전체 읽기 금지) + forbidden 목록을 프롬프트에 전부 싣는다.
3. **테스트 우선 순서 강제**: SKELETON에서 test-writer가 fail_paths의 빨간 테스트를
   먼저 만들고, IMPLEMENT의 dev는 그것을 green으로 만든다. (구현이 먼저면 테스트가
   구현을 베낀다 — 검증 비대칭 소실.)
4. **게이트는 직접 실행**: 워커 종료마다 `git status`로 실변경 확인(메타 발언만 반환한
   비정상 종료 감지) 후 해당 게이트 명령을 오케스트레이터가 돌린다.
5. **verifier 반증의 라우팅**: 구현 결함 → dev, 테스트 갭 → test-writer, 계약 모순 →
   HALT(사용자). findings를 그대로 복사해 전달하고, 재시도 카운터 r을 증가시킨다.
6. **동시성**: 같은 패키지에 쓰기 에이전트 2개 금지. Rust와 TS가 계약으로 분리되면
   병렬 가능하나, wasm 바인딩 경계를 같이 만지면 순차.
7. **소규모 예외**: 파일 1–2개·수십 줄 수정은 위임하지 않고 직접 한다. 단, 게이트는
   동일하게 통과해야 한다(예외는 위임 여부이지 검증 여부가 아니다).
8. **커밋은 G6 이후 사용자 승인 시에만.** 워커 전원에게 do-not-commit 전파.

## 5. 컨텍스트 엔지니어링 규칙 (보조 원칙)

- **저널이 인수인계 문서다**: HARNESS.md 6단계 섹션이 라운드별 결정·이유의 단일 원장.
  scribe는 append가 기본, 설계 뒤집힘만 REPLACE. 라운드 시작 시 dev에게는 직전
  1개 주기 기록만 지목해 읽힌다.
- **JIT 참조**: 워커에게 docs/ 전체가 아니라 계약 `docs` 목록의 파일만 지목.
- **판정은 구조화 출력**: verifier JSON, dev 보고는 "변경 파일 + 파일별 한 줄 이유 +
  게이트 자가 실행 결과" 고정 서식. 오케스트레이터 컨텍스트 오염 최소화.

## 6. 실행 예시 — 5주기(metrics) 라운드 인스턴스

HARNESS.md 5주기 갭 분석을 본 설계로 실체화한 첫 라운드:

- **CONTRACT**: 위 스키마 예시 그대로 (`get_machine_metrics`, packages: [core-rust, core],
  fail_paths: 미존재 id → `MACHINE_NOT_FOUND`, `historyTruncated` 명시 노출,
  timeline 500개 절단의 **무음성 제거**가 계약 조건).
- **SKELETON**: test-writer — Rust native 테스트 3개(집계 정확성, 미존재 id 거부,
  truncation 플래그) + vitest 1개(TS 표면) 빨간 상태로 작성.
- **IMPLEMENT**: dev — machine.rs 순수 집계 함수(history 재사용, 신규 상태 저장 금지)
  + wasm 래퍼 + core TS 바인딩.
- **GATES**: G0(2개 패키지), G1, G2, G3(`MACHINE_NOT_FOUND` 4중 존재 — 기존 코드에
  이미 있으면 테스트 assertion만 추가 확인), G4 생략(bench_sensitive: false).
- **VERIFY**: verifier — 특히 "집계가 history 순수 함수인가(신규 mutable 상태 없음)",
  "truncation이 silent인 경로가 남았나"를 반증 대상으로 지목.
- **QUALITY→RECORD**: slim 선택적, scribe가 HARNESS.md 5주기 섹션과
  docs/machine-runtime.md 갱신 → G5, G6 → 커밋 대기.

## 7. 마이그레이션 (완료, 2026-08-13)

1. ✅ sigmensa용 `.claude/agents/{orchestrator,dev,test-writer,scribe}.md`·
   `ORCHESTRATION.md`·`skills/harness/` 삭제.
2. ✅ 3절 로스터 5종 작성: `agents/{dev,verifier,test-writer,slim,scribe}.md`.
3. ✅ `/round` 스킬 작성 (`skills/round/SKILL.md`) — 1절 상태 기계 + 2절 게이트 명령표.
4. ✅ HARNESS.md 상단에 본 문서 참조 추가 (기존 주기 기록은 저널로 보존).
