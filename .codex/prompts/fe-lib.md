# /fe-lib — FE 라이브러리 하네스 실행

이 프롬프트를 `~/.codex/prompts/fe-lib.md`로 복사하면 Codex에서 `/fe-lib <요청>`으로 호출할 수 있다.

---

프론트엔드 라이브러리 코어 개발 요청이다. 다음 절차를 정확히 따르라:

1. 루트 `AGENTS.md`를 읽는다 — 패키지 지형, 명명·테스트 규약, 검증 명령, 금지 사항(알려진 지뢰)이
   전부 거기 있다. 검증은 반드시 AGENTS.md §5의 명령만 사용한다.
2. `.codex/skills/fe-lib-orchestrator.md`를 읽고 그 워크플로우(Phase 0~6)로 진행한다.
3. 각 Phase에서 지정된 역할 문서(`.codex/roles/fe-*.md`)와 스킬(`.codex/skills/fe-*.md`)을 읽고
   그 역할로 전환하여 작업한다. 역할 간 통신은 `_workspace/fe-lib/COMMS.md`에 기록한다.
4. breaking 판정이 나오면 구현 전에 반드시 사용자 확인을 받는다.
5. 완료 판정은 검증 명령을 직접 실행한 exit code로만 내린다.

요청: $ARGUMENTS
