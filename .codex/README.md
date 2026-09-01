# .codex — Codex용 FE 라이브러리 하네스

이 디렉터리는 `.claude/`의 fe-* 하네스(에이전트 4 + 스킬 5)를 **Codex(단일 에이전트) 실행 모델로 이식**한 것이다.
공용 원칙·패키지 지형·검증 명령·금지 사항은 루트 `AGENTS.md`가 규범이며, 이 하네스는 그 위의 실행 절차만 정의한다.

## Claude Code ↔ Codex 매핑

| Claude Code (`.claude/`) | Codex (`.codex/`) | 번역 |
|---|---|---|
| 서브에이전트 4종 (`agents/fe-*.md`) | 역할 정의 4종 (`roles/fe-*.md`) | 별도 프로세스 → **역할 전환**. 한 세션이 역할 문서를 읽고 그 역할로 작업 |
| `SendMessage` 팀 통신 | `_workspace/fe-lib/COMMS.md` append 로그 | 메시지 → 통신 로그 항목. 역할 전환 시 자기 앞으로 온 항목을 먼저 읽는다 |
| `TeamCreate`/`TaskCreate` 병렬 실행 | 모듈 단위 순차 루프 | 병렬 → **모듈별 (구현→테스트→QA) 루프**. incremental 검증 의도는 유지 |
| 스킬 5종 (`skills/*/SKILL.md`) | `skills/*.md` (내용 동일) | 그대로 |
| `_workspace/fe-lib/` 산출물 01~04 | 동일 경로, 동일 형식 | 그대로 — 두 하네스가 같은 산출물을 공유하므로 교차 이어받기 가능 |

## 실행 방법

1. 오케스트레이션 절차는 `skills/fe-lib-orchestrator.md`를 따른다 (Codex용으로 재기술됨).
2. 각 Phase에서 해당 역할 문서(`roles/fe-*.md`)와 역할별 스킬을 읽고 그 역할로 작업한다.
3. 역할 전환 전후로 `_workspace/fe-lib/COMMS.md`에 핸드오프를 기록한다.
4. 슬래시 프롬프트로 쓰려면 `prompts/fe-lib.md`를 `~/.codex/prompts/`에 복사한다 (→ `/fe-lib`).

## 동기화 규칙

`.claude/`와 `.codex/`는 같은 하네스의 두 표현이다. 한쪽의 역할·스킬 내용을 바꾸면
**같은 커밋에서** 다른 쪽도 갱신한다. 실행 메커니즘(팀 vs 역할 전환)만 다르고 원칙·체크리스트·
산출물 형식이 어긋나면 안 된다.
