---
name: fe-lib-orchestrator
description: "프론트엔드 라이브러리 코어 개발 에이전트 팀을 조율하는 오케스트레이터. 라이브러리 기능 추가, 코어 모듈 구현, API 설계+구현, 프론트엔드 코어 개발, 리팩토링 요청 시 반드시 이 스킬을 사용할 것. 후속 작업 — 이전 결과 수정, 부분 재실행, 다시 실행, 업데이트, 보완, 테스트만 다시, QA만 다시, API만 수정, 결과 개선 요청 시에도 반드시 이 스킬을 사용. 단순 질문/설명 요청에는 사용하지 않는다."
---

# FE Lib Orchestrator

프론트엔드 라이브러리 코어 개발 팀을 조율하여 설계 → 구현 → 테스트 → QA 검증을 거친 라이브러리 코드를 산출하는 통합 스킬.

## 실행 모드: 에이전트 팀

## 아키텍처: 파이프라인 (설계 → 구현) + 생성-검증 (incremental QA)

## 에이전트 구성

| 팀원 | 에이전트 타입 | 역할 | 스킬 | 출력 |
|------|-------------|------|------|------|
| fe-architect | 커스텀 (`fe-architect`) | 공개 API 계약 설계 | fe-api-design | `_workspace/fe-lib/01_fe-architect_api-design.md` |
| fe-core-builder | 커스텀 (`fe-core-builder`) | 코어 모듈 구현 | fe-core-implementation | 소스 코드 + `_workspace/fe-lib/02_fe-core-builder_impl-notes.md` |
| fe-test-engineer | 커스텀 (`fe-test-engineer`) | 유닛/타입 테스트 | fe-lib-testing | 테스트 코드 + `_workspace/fe-lib/03_fe-test-engineer_test-report.md` |
| fe-qa | 커스텀 (`fe-qa`) | 경계면 교차 검증 | fe-lib-qa | `_workspace/fe-lib/04_fe-qa_verification.md` |
| (리더 = 오케스트레이터) | — | 조율·통합·보고 | 이 스킬 | 최종 요약 보고 |

> 이 프로젝트의 `_workspace/` 루트에는 다른 용도의 산출물이 이미 있으므로, 이 하네스는 `_workspace/fe-lib/`를 작업 공간으로 사용한다.

## 워크플로우

### Phase 0: 컨텍스트 확인 (후속 작업 지원)

1. `_workspace/fe-lib/` 디렉토리 존재 여부 확인
2. 실행 모드 결정:
   - **미존재** → 초기 실행. Phase 1로 진행
   - **존재 + 부분 수정 요청** ("테스트만 다시", "API만 수정" 등) → **부분 재실행**. 해당 에이전트만 재호출하고 대상 산출물만 덮어쓴다. 수정된 산출물의 하류(예: API 수정 → 구현·테스트·QA)도 영향 범위만큼 재실행
   - **존재 + 새 기능/새 입력** → **새 실행**. 기존 `_workspace/fe-lib/`를 `_workspace/fe-lib_{YYYYMMDD_HHMMSS}/`로 이동 후 Phase 1 진행
3. 부분 재실행 시: 이전 산출물 경로를 에이전트 프롬프트에 포함하여, 기존 결과를 읽고 피드백을 반영하도록 지시

### Phase 1: 준비

1. 사용자 요청 분석 — 대상 기능, 기존 코드 영향 범위, breaking 가능성 파악
2. `_workspace/fe-lib/` 생성
3. 요청 원문과 파악된 요구사항을 `_workspace/fe-lib/00_input.md`에 저장

### Phase 2: 팀 구성

```
TeamCreate(
  team_name: "fe-lib-team",
  members: [
    { name: "fe-architect",     agent_type: "fe-architect",     model: "opus", prompt: "00_input.md를 읽고 fe-api-design 스킬에 따라 API 계약을 설계하라" },
    { name: "fe-core-builder",  agent_type: "fe-core-builder",  model: "opus", prompt: "계약 확정 알림 후 fe-core-implementation 스킬에 따라 구현하라. 모듈 단위로 완료를 알려라" },
    { name: "fe-test-engineer", agent_type: "fe-test-engineer", model: "opus", prompt: "모듈 완료 알림마다 fe-lib-testing 스킬에 따라 즉시 테스트하라" },
    { name: "fe-qa",            agent_type: "fe-qa",            model: "opus", prompt: "모듈 완료 알림마다 fe-lib-qa 스킬에 따라 경계면을 즉시 교차 검증하라" }
  ]
)

TaskCreate(tasks: [
  { title: "API 계약 설계",       assignee: "fe-architect" },
  { title: "코어 모듈 구현",       assignee: "fe-core-builder",  depends_on: ["API 계약 설계"] },
  { title: "유닛/타입 테스트",     assignee: "fe-test-engineer", depends_on: ["API 계약 설계"] },
  { title: "경계면 교차 검증",     assignee: "fe-qa",            depends_on: ["코어 모듈 구현"] },
  { title: "최종 통합 검증",       assignee: "fe-qa",            depends_on: ["코어 모듈 구현", "유닛/타입 테스트"] }
])
```

### Phase 3: 설계

fe-architect가 API 계약을 작성한다. 완료 시 fe-core-builder·fe-test-engineer에게 SendMessage로 확정 알림. 리더는 계약의 SemVer 판정에 **major(breaking)** 가 포함되면 구현 시작 전에 사용자에게 보고하고 진행을 확인받는다 — breaking은 되돌리기 어려운 결정이기 때문이다.

### Phase 4: 구현 + 테스트 + 점진 QA (병렬)

**팀원 간 통신 규칙:**
- fe-core-builder는 모듈 하나 완성마다 fe-test-engineer와 fe-qa에게 즉시 알림 (전체 완성 대기 금지)
- fe-test-engineer는 실패를 원인 분류하여 담당자에게 직접 전달 (구현 결함→builder, 계약 모호→architect)
- fe-qa는 경계면 결함을 경계 양쪽 담당자 모두에게 전달
- 계약 변경이 발생하면 fe-architect가 영향받는 팀원 전원에게 알림

**리더 모니터링:**
- 유휴 알림 수신 시 TaskGet으로 진행률 확인, 막힌 팀원에게 SendMessage로 개입
- 결함 수정 ↔ 재검증 루프는 팀원 자율에 맡기되, 동일 결함으로 3회 이상 반복되면 리더가 개입하여 계약 자체를 재검토

### Phase 5: 최종 통합 검증

1. TaskGet으로 전체 작업 완료 확인
2. fe-qa의 최종 검증 리포트(`04_fe-qa_verification.md`) 확인 — 실패 0이 목표, 실패 잔존 시 담당자 수정 후 재검증 (최대 2회, 이후 잔존 실패는 보고서에 명시)
3. 리더가 산출물 4종을 Read하여 최종 요약 작성: 구현된 export 목록, 테스트 결과, QA 판정, SemVer 영향, 알려진 제약

### Phase 6: 정리

1. 팀원 종료 요청 (SendMessage) → TeamDelete
2. `_workspace/fe-lib/` 보존 (사후 검증·감사 추적·후속 작업의 입력)
3. 사용자에게 결과 요약 보고 + 개선 피드백 기회 제공
4. 구조적 변경(에이전트/스킬 수정)이 있었으면 CLAUDE.md 변경 이력에 기록

## 데이터 흐름

```
[리더] → TeamCreate
  fe-architect ──01_api-design.md──→ fe-core-builder ──모듈 완료 알림──→ fe-test-engineer
       ↑                                   │                                │
       │ 계약 질의/모호 보고                  ├──소스 코드                      ├──03_test-report.md
       │                                   └──02_impl-notes.md              │
       └────────── fe-qa ←──모듈 완료 알림────┘←──────────────────────────────┘
                     └──04_verification.md──→ [리더: 통합 보고]
```

## 에러 핸들링

| 상황 | 전략 |
|------|------|
| 팀원 1명 실패/중지 | 리더가 감지 → SendMessage로 상태 확인 → 재시작, 재실패 시 대체 팀원 생성 |
| 팀원 과반 실패 | 사용자에게 알리고 진행 여부 확인 |
| 계약-구현 결함 루프 (3회+) | 리더 개입, 계약 재검토 후 해당 export 범위 축소 또는 보류 |
| 테스트 러너 실행 불가 | 타입 체크만으로 진행, 최종 보고에 "런타임 테스트 미실행" 명시 |
| breaking 판정 | 구현 전 사용자 확인 필수 — 확인 전 구현 착수 금지 |
| 타임아웃 | 완료된 모듈까지만 통합, 미완료 export를 보고서에 명시 |
| 팀원 간 판단 충돌 | 계약 문서가 기준. 계약이 침묵하면 fe-architect가 계약을 보강하여 해소 |

## 테스트 시나리오

### 정상 흐름
1. 사용자: "이벤트 에미터 코어 모듈 만들어줘"
2. Phase 1: 요구 분석 → `00_input.md` 저장
3. Phase 2: 4명 팀 구성 + 5개 작업 등록
4. Phase 3: fe-architect가 `on/off/emit/once` 계약 설계 (minor), 팀에 확정 알림
5. Phase 4: builder가 모듈 구현 → 완료 알림 → test-engineer 테스트 + qa 경계면 검증 병렬 수행
6. Phase 5: QA 리포트 실패 0 확인 → 리더 통합 보고
7. 예상 결과: 소스 + 테스트 + `_workspace/fe-lib/01~04` 산출물 생성

### 에러 흐름
1. Phase 4에서 fe-qa가 계약-구현 시그니처 불일치 발견 (`emit`의 반환 타입 상이)
2. fe-qa가 fe-architect와 fe-core-builder 모두에게 파일:라인 + 수정 방법 전달
3. fe-architect가 계약 오류로 판정, 계약 수정 후 팀에 알림
4. fe-core-builder는 유지, fe-test-engineer가 해당 테스트 기대값 갱신
5. fe-qa 재검증 통과 → 정상 흐름 복귀
6. 최종 보고서에 결함 발견·해소 이력 명시
