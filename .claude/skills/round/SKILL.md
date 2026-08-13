---
name: round
description: 검증 게이트형 라운드 실행. 라운드 계약 확정 → 테스트 우선 스켈레톤 → 구현 → 게이트(G0–G6) → 적대적 검수 → 품질 → 저널 기록을 상태 기계로 집행한다. "라운드 돌려줘", "N주기 시작", "품질 라운드", "커밋 전 검수" 요청 시 사용. 인자: 라운드명(예: "5주기 metrics") 또는 단계 지정(verify/quality만).
---

# /round — 검증 게이트형 라운드

`.claude/ARCHITECTURE.md`의 상태 기계를 집행한다. 메인 세션이 오케스트레이터다.
**전이 조건은 게이트 명령의 exit code뿐** — 에이전트 보고를 게이트 판정에 쓰지 않는다.

## 절차

1. **CONTRACT**: ARCHITECTURE.md 1절 스키마로 라운드 계약 YAML을 채워 사용자에게
   제시하고 확정받는다. HARNESS.md 6단계에서 해당 주기의 갭 분석을 참조.
   동시에 **기준선 게이트**(G1+G2)를 1회 실행해 사전 존재 실패를 기록한다.
2. **SKELETON**: `test-writer`에 계약 전문 + fail_paths를 전달, 빨간 테스트 작성.
   빨간 사유가 "미구현"인지 확인(잘못된 기대면 계약 재검토).
3. **IMPLEMENT**: `dev`에 계약 전문 + HARNESS.md 지정 섹션 + forbidden 목록 전달.
   같은 패키지에 쓰기 에이전트 2개 동시 금지. 종료 시 `git status`로 실변경 확인
   (메타 발언만 반환한 비정상 종료 감지 → 동일 프롬프트 재실행).
4. **GATES** (오케스트레이터 직접 실행):
   - G0 범위: `git status --short` + `git diff --stat` 를 계약 packages와 대조
   - G1 정적: `cargo check --manifest-path packages/core-rust/Cargo.toml` /
     `pnpm --filter gaesup-state run type-check` (+ 변경된 어댑터 패키지)
   - G2 테스트: `cargo test --manifest-path packages/core-rust/Cargo.toml` /
     `pnpm --filter gaesup-state run test` — skip 0, 기준선 제외 실패 0
   - G3 계약 감사: 계약 error_codes/audit_events 각각
     `grep -rn "<이름>" packages/core-rust/src packages/core/src` → Rust 소스·TS 표면·
     테스트 assertion 모두 hit + fail_paths별 거부 테스트 존재
   - G4 벤치 (bench_sensitive時): `pnpm run bench:runtime` 기준선 대비
   - 실패 시: 해당 게이트의 실패 출력을 그대로 `dev`(구현 갭) 또는
     `test-writer`(테스트 갭)에 전달하고 재시도 카운터 r 증가. **r > 3이면 HALT** —
     diff 보존한 채 현황 보고 후 사용자 판단 대기.
5. **VERIFY**: `verifier`에 계약 전문 + diff 범위 전달. 판정 JSON 수신.
   - refute(critical/major) → findings를 그대로 dev/test-writer에 라우팅, 4로 복귀 (r 증가)
   - approve + minor findings → minor는 QUALITY 백로그로
   - 보안·격리 계약 라운드(permission/allowedImports/integrity/sandbox)는 verifier
     단독 대신 Workflow 3-반증자 다수결(correctness/fail-closed/경계 렌즈)로 승격
6. **QUALITY** (선택적): `slim`에 백로그 전달, 병렬은 패키지 단위로만.
   완료 후 G1+G2 재확인.
7. **RECORD**: `scribe`에 확정 결과(게이트 내역·테스트 수·에러 코드)를 전달 —
   HARNESS.md 주기 기록 + 계약 docs 갱신. G5로 diff 확인.
8. **G6 회귀**: 전체 G1+G2 1회 재실행 → green이면 커밋 준비 완료 보고.
   **커밋은 사용자 승인 후에만.**

## 부분 실행

- `/round verify` — 5번만: 현재 diff에 대한 적대적 검수 단독 (커밋 전 점검용).
- `/round quality` — 6번만: 백로그 소화 라운드.

## 주의

- 워커 프롬프트는 자기완결: 계약 전문, 파일 경로, HARNESS.md **섹션 지정**(전체 읽기
  금지), 알려진 함정을 전부 싣는다. 워커는 이 대화를 못 본다.
- 파일 1–2개·수십 줄 수정은 위임하지 않고 직접 한다 — 단 게이트는 동일하게 통과.
- 사전 존재 실패는 기준선 목록으로 관리하고 이번 라운드 탓으로 오인하지 않는다.
