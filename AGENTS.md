# AGENTS.md

## 역할

이 저장소에서 작업하는 에이전트는 Gaesup을 단순 상태 관리 라이브러리가 아니라 **부분 배포 프론트엔드 컨테이너를 위한 WASM 기반 상태 계약 런타임**으로 다룬다.

핵심 제품 축은 다음이다.

- WASM state engine
- Container manifest validation
- Store schema compatibility guard
- Framework adapters
- Partial deployment workflow
- Step/state-machine runtime
- Observability and rollback support

## 하네스 엔지니어링 관점

이 저장소의 테스트와 예제는 데모가 아니라 **런타임 계약을 증명하는 하네스**로 다룬다. 하네스는 제품 코드를 느슨하게 통과시키기 위한 장치가 아니라, container attach 전에 어떤 계약이 반드시 강제되는지 반복 가능하게 보여주는 실행 가능한 증거여야 한다.

하네스가 검증해야 하는 핵심 질문은 다음이다.

1. 이 컨테이너가 attach되기 전에 hash/signature, ABI, schema, permission, import, deployment slot 계약을 통과했는가?
2. 실패 경로가 성공 경로만큼 명확하게 검증되는가?
3. mock, fixture, fake runtime이 실제 sandbox runtime처럼 오해되지 않도록 이름과 경계가 분명한가?
4. 테스트가 구현 세부사항보다 public contract와 operator-visible event/error code를 검증하는가?
5. CI에서 변경된 manifest, artifact, slot pointer만 검증해도 전체 계약 안전성이 유지되는가?

## 최우선 방향

1. 컨테이너는 로드된다고 신뢰하지 않는다. hash/signature, ABI, schema, permission, import, deployment slot 계약을 통과한 뒤에만 attach한다.
2. 선언적 manifest 필드는 실제 런타임 정책으로 강제되어야 한다. 특히 `permissions`, `allowedImports`, store schema policy는 문서만 두지 않는다.
3. WASM은 hot path와 deterministic transition에 우선 사용한다. 큰 JSON 객체를 JS/WASM 경계로 반복 이동시키는 설계는 피한다.
4. Side effect는 WASM에서 직접 실행하지 않는다. WASM은 effect descriptor를 반환하고, JS host가 permission check 후 실행한다.
5. Framework adapter는 얇게 유지하되 lifecycle 계약은 강하게 맞춘다.

## 구현 원칙

### KISS

- 가장 단순하게 동작하는 구현을 먼저 만든다.
- 추상화는 실제 중복이나 복잡도를 줄일 때만 추가한다.
- 새 runtime layer, registry, adapter abstraction을 만들기 전에 기존 코드의 패턴을 우선 사용한다.
- 복잡한 statechart 기능은 flat step workflow가 안정화된 뒤에만 확장한다.

### DRY

- 같은 manifest/schema/permission 검증 로직을 Rust, TS, script에 중복으로 흩뿌리지 않는다.
- 에러 코드, policy 이름, lifecycle event 이름은 한 곳의 계약을 기준으로 맞춘다.
- React/Vue/Svelte/Angular adapter는 프레임워크별 표현만 다르게 하고 lifecycle 의미는 공유한다.
- 테스트 fixture와 manifest 예제는 재사용 가능한 형태로 둔다.

### Fail Closed

- 권한, import, schema compatibility, artifact hash가 애매하면 허용하지 않는다.
- allowlist가 없으면 deny가 기본이다.
- compatibility check 실패 시 mount 전에 차단하거나 명시적으로 isolate/shadow 처리한다.
- 실패를 조용히 무시하지 말고 stable error code와 audit event를 남긴다.

### 작은 변경

- 한 PR/작업은 하나의 제품 계약 또는 버그에 집중한다.
- unrelated refactor, 포맷 대량 변경, 파일 이동은 피한다.
- 성능 최적화는 benchmark 또는 측정 지점과 함께 한다.
- public API를 바꿀 때는 문서와 테스트를 함께 갱신한다.

## 하네스 작성 원칙

### Contract-First

- 테스트는 내부 구현 함수 호출 여부보다 public API, manifest result, timeline event, audit event, stable error code를 우선 검증한다.
- 성공 케이스만 추가하지 않는다. 같은 변경에는 가능한 한 fail-closed 케이스를 함께 둔다.
- 하네스에서 허용한 fixture가 실제 runtime에서도 허용되는지 확인한다. fixture 전용 예외는 명시적으로 이름에 드러낸다.
- 새 manifest field는 validator test, runtime enforcement test, 예제 manifest를 함께 갱신한다.

### Fake와 Real Runtime 경계

- fake, mock, stub, demo container는 실제 sandbox처럼 포장하지 않는다.
- fake runtime은 계약 하나를 고립해서 검증할 때만 사용하고, 이름에 `fake`, `mock`, `demo`, `inMemory` 같은 의도를 드러낸다.
- 외부 `.wasm` artifact attach 경로는 hash/signature, `allowedImports`, permission, isolation을 통과하는 통합 하네스가 있어야 한다.
- `ContainerManager` 같은 demo/in-memory lifecycle API와 `MicroSandboxRuntime`/`FrontendSandboxOrchestrator` 같은 sandbox attach API를 섞지 않는다.

### Fixture와 Golden Data

- fixture manifest는 실제 spec과 drift되지 않게 유지한다.
- invalid fixture는 왜 invalid인지 파일명이나 테스트명에 드러낸다.
- fixture를 재사용하되, 테스트가 서로 상태를 공유해 순서 의존성을 만들지 않는다.
- snapshot/golden output은 operator가 읽을 수 있는 error code, target, message, audit event를 포함해야 한다.

### Determinism

- 시간, random id, network, filesystem, worker lifecycle은 테스트에서 제어 가능한 seam을 둔다.
- 테스트는 순서와 머신 환경에 덜 민감해야 한다.
- flaky test를 통과시키기 위해 assertion을 느슨하게 만들지 않는다. 원인을 격리하거나 하네스를 고친다.
- benchmark는 pass/fail 기준과 측정 의도를 분리한다. 성능 regression check와 탐색용 benchmark를 혼동하지 않는다.

### CI Harness

- changed-path detection은 변경된 container만 찾되, shared validator/script/release-plan 변경 시 영향 범위를 넓힌다.
- CI는 검증된 artifact만 registry slot pointer로 승격해야 한다.
- compatibility 실패는 배포 차단으로 이어져야 하며, 로그에는 어떤 slot/manifest/policy가 실패했는지 남아야 한다.
- rollback 하네스는 새 빌드를 만들지 않고 slot pointer가 이전 검증 artifact를 가리키는지 확인한다.

## 금지 사항

- `any`로 public contract를 숨기지 않는다. 임시 `any`가 필요하면 내부 구현에만 국한하고 TODO 근거를 남긴다.
- mock container를 실제 sandbox runtime처럼 포장하지 않는다.
- manifest field를 추가하고 runtime enforcement 없이 끝내지 않는다.
- permission check를 UI 표시나 문서 안내로 대체하지 않는다.
- WASM 내부에서 네트워크, 스토리지, DOM side effect를 직접 실행하는 방향으로 설계하지 않는다.
- 전체 XState 호환성, browser Docker 같은 과장된 claim을 하지 않는다.
- parallel/nested statechart, visual editor 같은 V2 기능을 V1 안정화 전에 끌어오지 않는다.
- generic JSON state 최적화를 측정 없이 과하게 진행하지 않는다.
- adapter마다 서로 다른 lifecycle semantics를 만들지 않는다.
- 테스트를 통과시키기 위해 검증을 느슨하게 만들지 않는다.
- 하네스에서만 통과하는 특수 경로를 제품 계약처럼 문서화하지 않는다.
- flaky test를 `skip`, timeout 증가, 넓은 matcher만으로 덮지 않는다.

## 필수 계약

### Container Runtime

- 외부 `.wasm` artifact는 hash/signature 검증 후 로드한다.
- `allowedImports`를 강제한다.
- host function은 capability registry를 통해서만 주입한다.
- Worker 또는 iframe isolation이 필요한 runtime은 격리된 실행 경계를 사용한다.
- container memory, storage namespace, event channel, network access를 분리한다.
- denied capability는 audit log에 남긴다.

### Store Schema

- 기본 conflict policy는 `reject`다.
- `isolate`는 공유 store 대신 격리 store에 attach한다.
- `migrate`는 공유 store attach 전에 migration을 완료해야 한다.
- `readonly`는 incompatible container의 write를 거부한다.
- `shadow`는 preview/testing용 copied state에서만 실행한다.
- `dual-write`는 점진 migration 중 old/new schema write를 명시적으로 기록한다.

### Adapter Contract

모든 framework adapter는 같은 의미의 계약을 제공해야 한다.

- `mount`
- `unmount`
- `subscribe`
- `dispatch`
- `getSnapshot`
- `onError`

반드시 보장할 것:

- unmount 시 subscription cleanup.
- mount 실패 시 명확한 error propagation.
- isolated store fallback 동작 일관성.
- repeated mount/unmount 테스트.

### Machine Runtime

Machine V1은 다음 범위만 목표로 한다.

- flat finite states
- event transitions
- named guards
- assign/context updates
- entry/exit/action descriptors
- final states
- snapshots
- step history
- rollback
- store metrics와 DevTools timeline 연동

V1에서는 다음을 하지 않는다.

- nested states
- parallel states
- delayed transitions
- actor-like child machines
- promise/observable/websocket actors
- full XState compatibility

## Observability

다음 event는 runtime timeline에 남기는 것을 기본 방향으로 한다.

- `manifest:fetched`
- `manifest:validated`
- `container:loaded`
- `store:attached`
- `store:isolated`
- `machine:transitioned`
- `effect:requested`
- `effect:denied`
- `container:stopped`

metrics는 store, container, machine, deployment slot 단위로 추적할 수 있어야 한다.

## CI/CD

- GitHub Actions에서 변경된 container를 감지한다.
- 영향받은 manifest만 검증한다.
- 영향받은 artifact만 빌드한다.
- 검증된 container만 registry slot pointer를 업데이트한다.
- compatibility check 실패 시 배포를 차단한다.
- rollback은 slot pointer를 이전 artifact로 되돌리는 방식으로 지원한다.

## 테스트 기준

필수 테스트:

- fail-closed import/permission behavior
- artifact hash mismatch
- schema reject/isolate/migrate/readonly/shadow policy
- repeated adapter mount/unmount cleanup
- failed mount behavior
- machine guard rejection
- invalid transition
- final state
- rollback
- persisted machine snapshot
- changed-path notification
- sandbox/demo runtime boundary
- audit/timeline event for denied capability

성능 테스트:

- JSON path
- batch path
- typed fast lane
- machine transition

하네스 품질 테스트:

- changed-path detection
- affected manifest validation
- registry slot pointer update
- rollback pointer restoration
- invalid fixture stays blocked

## 문서 기준

문서는 구현과 같이 움직인다.

- runtime behavior가 바뀌면 관련 docs를 갱신한다.
- manifest spec 변경은 예제 manifest와 validator test를 함께 갱신한다.
- public API 변경은 README 또는 API reference에 반영한다.
- 아직 구현되지 않은 기능은 implemented처럼 쓰지 않는다.
- 하네스 전용 fake 또는 demo 경로는 실제 sandbox/runtime 보장처럼 설명하지 않는다.

## 작업 전 체크

작업을 시작하기 전에 다음을 확인한다.

1. 이 변경이 state contract runtime 방향에 맞는가?
2. runtime enforcement가 있는가, 아니면 문서/타입만 있는가?
3. 실패 시 fail-closed인가?
4. adapter나 manifest contract를 깨지 않는가?
5. 테스트나 benchmark로 확인할 수 있는가?
6. mock/fake가 실제 runtime 경계를 흐리지 않는가?
7. operator가 실패 원인을 audit/timeline/error code로 알 수 있는가?

## 작업 후 체크

작업이 끝나면 다음을 확인한다.

1. 관련 테스트를 실행했다.
2. 실행하지 못한 테스트는 이유를 남겼다.
3. public API/manifest/docs 변경이 동기화됐다.
4. 불필요한 refactor나 포맷 변경이 섞이지 않았다.
5. operator가 실패 원인을 알 수 있는 error code 또는 audit event가 있다.
6. 하네스가 성공 경로뿐 아니라 실패 경로를 검증한다.
7. fixture, 예제 manifest, CI script가 같은 계약을 바라본다.
