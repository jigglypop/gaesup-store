# CLAUDE.md — Claude Code 진입점

공용 원칙·패키지 지형·검증 명령·금지 사항은 아래 공유 문서가 규범이다. 전문을 따른다.

@AGENTS.md

## Claude Code 전용 구성

- **오케스트레이션**: 라운드 상태 기계(CONTRACT → SKELETON → IMPLEMENT → GATES → VERIFY →
  QUALITY → RECORD)와 게이트 G0~G6 정의는 `.claude/ARCHITECTURE.md`. 실행은 `/round` 스킬.
- **라운드 계약**: `.claude/rounds/*.yaml` (현재 진행: `R1-mvp-0.1.yaml`).
- **저널**: `HARNESS.md` — 라운드 기록은 append가 기본, 설계 뒤집힘일 때만 REPLACE.

### 서브에이전트 로스터 (`.claude/agents/`)

| 에이전트 | 역할 | 제약 |
|---|---|---|
| `dev` | IMPLEMENT 단계 구현 | 계약 allowlist 밖 수정 금지, 커밋 금지 |
| `test-writer` | SKELETON(빨간 테스트 우선)·테스트 보강 | 구현 코드 수정 금지 |
| `verifier` | VERIFY 적대적 검수 (반증 지향) | **읽기 전용** — Edit/Write 없음, JSON 판정만 |
| `slim` | QUALITY 무동작변경 개선 | public API·에러 코드·이벤트 이름 불변 |
| `scribe` | RECORD 저널·문서 갱신 | 코드 동작 불변 (문서·주석만) |

같은 패키지에 쓰기 에이전트 2개 동시 투입 금지. 게이트 판정은 오케스트레이터(메인 세션)가
명령을 **직접 재실행**해서 내린다 — 에이전트 자가 보고는 참고용.

### 운영 수칙

- 메인 세션이 오케스트레이터다. 코드 대량 탐색은 Explore 서브에이전트에 위임하고 결론만 취한다.
- 게이트 실패 출력은 가공 없이 해당 에이전트(dev 또는 test-writer)에 그대로 전달한다.
- 재시도 r > 3이면 HALT: diff를 보존한 채 현황을 보고하고 사용자 판단을 기다린다.
- 커밋·푸시는 사용자가 요청할 때만. 커밋 전 `/round verify`(적대적 검수 단독 실행)를 권장.
