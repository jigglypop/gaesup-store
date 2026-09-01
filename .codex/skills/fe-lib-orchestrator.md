# FE Lib Orchestrator (Codex 단일 에이전트 버전)

프론트엔드 라이브러리 코어 개발을 설계 → 구현 → 테스트 → QA 검증 순서로 산출하는 통합 절차.
`.claude/skills/fe-lib-orchestrator/SKILL.md`(팀 실행 버전)와 동일한 하네스의 단일 에이전트 표현이다.

## 실행 모드: 역할 전환 파이프라인 (단일 세션)

Codex에는 서브에이전트·팀·메시징이 없다. 대신 한 세션이 역할 문서(`.codex/roles/fe-*.md`)를 읽고
그 역할로 전환하며, 역할 간 통신은 `_workspace/fe-lib/COMMS.md`에 append하는 항목으로 대신한다.

**역할 전환 규칙:**
- 역할로 들어갈 때: 해당 역할 문서 + 역할별 스킬을 읽고, COMMS.md에서 자기 앞으로 온 항목을 먼저 처리한다
- 역할에서 나올 때: 산출물을 쓰고, 다음 역할 앞으로 COMMS.md 항목을 남긴다
- COMMS.md 항목 형식: `- [보낸 역할 → 받는 역할] (모듈/주제) 내용 — 파일:라인`
- 한 시점에 한 역할만 수행한다. 역할을 섞지 않는다 (빌더가 검증하며 QA 판정을 내리는 식의 겸직 금지)

## 역할 구성

| 역할 | 역할 문서 | 스킬 | 출력 |
|------|----------|------|------|
| fe-architect | `.codex/roles/fe-architect.md` | fe-api-design | `_workspace/fe-lib/01_fe-architect_api-design.md` |
| fe-core-builder | `.codex/roles/fe-core-builder.md` | fe-core-implementation | 소스 코드 + `_workspace/fe-lib/02_fe-core-builder_impl-notes.md` |
| fe-test-engineer | `.codex/roles/fe-test-engineer.md` | fe-lib-testing | 테스트 코드 + `_workspace/fe-lib/03_fe-test-engineer_test-report.md` |
| fe-qa | `.codex/roles/fe-qa.md` | fe-lib-qa | `_workspace/fe-lib/04_fe-qa_verification.md` |
| (오케스트레이터) | — (기본 세션) | 이 스킬 | COMMS.md 관리 + 최종 요약 보고 |

> 이 프로젝트의 `_workspace/` 루트에는 다른 용도의 산출물이 이미 있으므로, 이 하네스는 `_workspace/fe-lib/`를 작업 공간으로 사용한다.

## 워크플로우

### Phase 0: 컨텍스트 확인 (후속 작업 지원)

1. `_workspace/fe-lib/` 디렉토리 존재 여부 확인
2. 실행 모드 결정:
   - **미존재** → 초기 실행. Phase 1로 진행
   - **존재 + 부분 수정 요청** ("테스트만 다시", "API만 수정" 등) → **부분 재실행**. 해당 역할만 재수행하고 대상 산출물만 덮어쓴다. 수정된 산출물의 하류(예: API 수정 → 구현·테스트·QA)도 영향 범위만큼 재수행
   - **존재 + 새 기능/새 입력** → **새 실행**. 기존 `_workspace/fe-lib/`를 `_workspace/fe-lib_{YYYYMMDD_HHMMSS}/`로 이동 후 Phase 1 진행
3. 부분 재실행 시: 역할 진입 전에 이전 산출물을 읽고 피드백을 증분 반영한다

### Phase 1: 준비

1. 사용자 요청 분석 — 대상 기능, 기존 코드 영향 범위, breaking 가능성 파악
2. `_workspace/fe-lib/` 생성, `COMMS.md` 초기화 (기존 실행이면 이어서 append)
3. 요청 원문과 파악된 요구사항을 `_workspace/fe-lib/00_input.md`에 저장

### Phase 2: 계획 수립

팀 생성 대신, 이번 실행의 작업 목록과 순서를 COMMS.md 상단에 기록한다:

```markdown
## 작업 계획
1. [ ] API 계약 설계 (fe-architect)
2. [ ] 코어 모듈 구현 — 모듈 단위 (fe-core-builder)
3. [ ] 유닛/타입 테스트 — 모듈 단위 (fe-test-engineer)
4. [ ] 경계면 교차 검증 — 모듈 단위 + 최종 (fe-qa)
5. [ ] 최종 통합 검증 및 보고 (오케스트레이터)
```

진행하며 체크한다. 이 목록이 팀 버전의 TaskCreate/TaskGet을 대신한다.

### Phase 3: 설계

**fe-architect 역할로 전환**하여 API 계약을 작성한다. 완료 시 COMMS.md에 확정 항목을 남긴다.
계약의 SemVer 판정에 **major(breaking)** 가 포함되면 구현 시작 전에 사용자에게 보고하고 진행을
확인받는다 — breaking은 되돌리기 어려운 결정이기 때문이다.

### Phase 4: 모듈 단위 (구현 → 테스트 → QA) 루프

팀 버전의 병렬 incremental 검증을 순차 루프로 보존한다. 계약의 모듈 목록에 대해 **모듈 하나씩**:

1. **fe-core-builder 역할**: 모듈 구현 + 타입 체크 통과 → COMMS.md에 모듈 완료 항목
2. **fe-test-engineer 역할**: 해당 모듈 테스트 작성·실행 → 실패는 원인 분류하여 담당 역할 앞으로 기록
   (구현 결함→builder, 계약 모호→architect, 테스트 오류→자체 수정)
3. **fe-qa 역할**: 해당 모듈의 경계면 즉시 교차 검증 → 결함은 경계 양쪽 담당 역할 모두 앞으로 기록
4. 결함이 있으면 담당 역할로 전환하여 수정 → 재검증. 전체 모듈 완성을 기다렸다가 몰아서 검증하지 않는다

**루프 규칙:**
- 계약 변경이 발생하면 fe-architect 역할에서 계약을 갱신하고 COMMS.md에 전원 앞 항목을 남긴 뒤, 영향받는 완료 모듈을 재확인한다
- 동일 결함으로 수정 ↔ 재검증이 3회 이상 반복되면 루프를 멈추고 계약 자체를 재검토한다

### Phase 5: 최종 통합 검증

1. COMMS.md 작업 계획의 전체 완료 확인
2. **fe-qa 역할**로 최종 검증 (체크리스트 전량) → `04_fe-qa_verification.md` 완성 — 실패 0이 목표,
   실패 잔존 시 담당 역할 수정 후 재검증 (최대 2회, 이후 잔존 실패는 보고서에 명시)
3. **오케스트레이터로 복귀**하여 산출물 4종을 읽고 최종 요약 작성: 구현된 export 목록, 테스트 결과,
   QA 판정, SemVer 영향, 알려진 제약. QA 리포트의 "통과" 주장은 검증 명령(테스트·타입 체크)을
   **직접 재실행한 exit code로 재확인**한다 — 자가 보고를 그대로 믿지 않는다

### Phase 6: 정리

1. `_workspace/fe-lib/` 보존 (사후 검증·감사 추적·후속 작업의 입력)
2. 사용자에게 결과 요약 보고 + 개선 피드백 기회 제공
3. 구조적 변경(역할/스킬 수정)이 있었으면 `.claude/` 쪽 대응 파일도 같은 커밋에서 동기화한다 (`.codex/README.md` 동기화 규칙)

## 데이터 흐름

```
[오케스트레이터] → 00_input.md + COMMS.md 작업 계획
  fe-architect ──01_api-design.md──→ ┌─ 모듈 루프 (모듈마다) ─────────────┐
       ↑                            │ fe-core-builder ──완료 항목──→     │
       │ 계약 질의/모호 항목           │   fe-test-engineer ──03 갱신──→   │
       │ (COMMS.md 경유)             │     fe-qa ──04 갱신·결함 항목──→   │
       └────────────────────────────┴──결함 시 담당 역할로 전환·수정───────┘
                                        └──→ [오케스트레이터: 최종 검증·통합 보고]
```

## 에러 핸들링

| 상황 | 전략 |
|------|------|
| 역할 수행 중 막힘 | COMMS.md에 막힌 지점 기록 후 오케스트레이터로 복귀하여 우회 결정 (범위 축소/보류/사용자 질의) |
| 계약-구현 결함 루프 (3회+) | 루프 중단, 계약 재검토 후 해당 export 범위 축소 또는 보류 |
| 테스트 러너 실행 불가 | 타입 체크만으로 진행, 최종 보고에 "런타임 테스트 미실행" 명시 |
| breaking 판정 | 구현 전 사용자 확인 필수 — 확인 전 구현 착수 금지 |
| 세션 중단/타임아웃 | 완료된 모듈까지만 통합, 미완료 export를 보고서에 명시. COMMS.md와 산출물이 재개 지점이다 |
| 역할 간 판단 충돌 | 계약 문서가 기준. 계약이 침묵하면 fe-architect 역할에서 계약을 보강하여 해소 |

## 테스트 시나리오

### 정상 흐름
1. 사용자: "이벤트 에미터 코어 모듈 만들어줘"
2. Phase 1: 요구 분석 → `00_input.md` 저장, COMMS.md 작업 계획 기록
3. Phase 3: fe-architect 역할로 `on/off/emit/once` 계약 설계 (minor), 확정 항목 기록
4. Phase 4: 모듈별로 builder 구현 → 완료 항목 → test-engineer 테스트 → qa 경계면 검증
5. Phase 5: QA 리포트 실패 0 + 오케스트레이터가 테스트·타입 체크 직접 재실행 확인 → 통합 보고
6. 예상 결과: 소스 + 테스트 + `_workspace/fe-lib/00~04 + COMMS.md` 산출물 생성

### 에러 흐름
1. Phase 4에서 fe-qa 역할이 계약-구현 시그니처 불일치 발견 (`emit`의 반환 타입 상이)
2. COMMS.md에 fe-architect·fe-core-builder 양쪽 앞으로 파일:라인 + 수정 방법 기록
3. fe-architect 역할로 전환, 계약 오류로 판정하고 계약 수정 + 전원 앞 항목 기록
4. 구현은 유지, fe-test-engineer 역할로 해당 테스트 기대값 갱신
5. fe-qa 역할 재검증 통과 → 정상 흐름 복귀
6. 최종 보고서에 결함 발견·해소 이력 명시
