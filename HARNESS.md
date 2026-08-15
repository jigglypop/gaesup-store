# Gaesup-State 하네스 엔지니어링

AGENTS.md의 원칙을 실제 작업 흐름으로 옮기는 체크리스트와 반복 개선 루프.

## 라운드 구조

각 라운드는 하나의 핵심 계약에 집중하고, 성공/실패 경로 모두 검증한다.

```
┌─ Implement Core Contract
│  ├─ Schema/ABI/Manifest 정의
│  ├─ Test (happy path + fail-closed)
│  ├─ Implementation
│  └─ README 업데이트
│
├─ QC & Regression Check
│  ├─ 단위/통합 테스트 실행
│  ├─ Fixture/Golden data 검증
│  ├─ Error code/audit event 확인
│  └─ 기존 기능 회귀 확인
│
├─ Code Quality (no-op 범위)
│  ├─ 중복 제거
│  ├─ Fixture DRY (같은 schema 정의 곳곳에 흩어짐 → 통일)
│  └─ Test naming/organization 개선
│
└─ Loop 후 다음 라운드
```

## 1단계: Core Contract 정의

### 체크리스트

- [ ] **Manifest/Schema 스펙 명확화**
  - 새 필드/정책 이름 정의
  - validator와 runtime enforcement 범위 정의
  - fail-closed 경로 명시

- [ ] **Public API 설계**
  - Rust/WASM core 인터페이스
  - TypeScript 바인딩
  - Framework adapter 계약 (React/Vue/Svelte/Angular)
  - Error code와 audit event 이름 정의

- [ ] **Test Skeleton 작성** (구현 전)
  - Happy path 시나리오
  - Fail-closed 케이스 (최소 각 정책당 1개)
  - Contract boundary 테스트
  - Fixture manifest와 예제 작성

### 예: Store Schema `reject` Policy 구현

```markdown
### Manifest field
`stores[].schema.conflict: "reject" | "isolate" | "migrate" | "readonly" | "shadow" | "dual-write"`

### Validator
- 문자열 check
- 해당 policy가 구현됐는지 확인 (migrate는 `migrationPath` 필수)

### Runtime Enforcement
- Store attach 시 schema 호환성 검사
- 불일치 시 즉시 차단 (reject) 또는 isolation (isolate)
- Audit log에 `store:conflict-rejected` 이벤트 기록

### Error Code
`STORE_CONFLICT_INCOMPATIBLE_SCHEMA` (reject 시)
`STORE_ATTACHED_ISOLATED` (isolate 시)

### Test Cases
✓ Same schema version → accept
✓ Higher minor version → accept (if compatible)
✗ Conflict detected → reject, audit log 있음
✗ Isolated store → separate runtime, 공유 상태 없음
✓ Repeated attach/detach → cleanup 확인
```

## 2단계: Implementation

### Rust/WASM Core (packages/core-rust/src/)

- [ ] **Struct/Enum 정의**
  ```rust
  pub enum ConflictPolicy {
    Reject,
    Isolate,
    Migrate { path: String },
    // ...
  }
  
  pub fn validate_schema_compatibility(
    current: &Schema,
    incoming: &Schema,
    policy: ConflictPolicy,
  ) -> Result<AttachDecision, StoreError> { ... }
  ```

- [ ] **Deterministic transition 작성**
  - WASM에서 순수 함수로 구현
  - Side effect는 descriptor return
  - JS host에서 permission/audit check 후 실행

### TypeScript Bindings (packages/core/src/)

- [ ] **WASM import 추가**
  ```typescript
  export function validateSchemaCompatibility(
    current: StoreSchema,
    incoming: StoreSchema,
    policy: ConflictPolicy,
  ): AttachDecision { ... }
  ```

- [ ] **Error code + message mapping**
  ```typescript
  export const STORE_ERRORS = {
    SCHEMA_CONFLICT: 'Schema mismatch: require migration or isolation',
    INCOMPATIBLE_ABI: 'WASM ABI version mismatch',
    // ...
  } as const;
  ```

### Framework Adapter (packages/frameworks/react/src/)

- [ ] **useGaesup 훅에서 conflict handling**
  ```typescript
  export function useGaesup<T>(store: Store<T>) {
    const [snapshot, setSnapshot] = React.useState(store.getSnapshot());
    
    React.useEffect(() => {
      const unsubscribe = store.subscribe((newSnapshot, event) => {
        if (event.type === 'store:conflict-detected') {
          // Fail-closed: UI에 명시적 에러 표시
          throw new Error(`Store conflict: ${event.details}`);
        }
        setSnapshot(newSnapshot);
      });
      return unsubscribe;
    }, []);
  }
  ```

### Documentation & Examples

- [ ] **공개 문서 업데이트**
  - `docs/manifest-spec.md`: 새 필드 추가
  - `docs/error-codes.md`: 새 error code 문서화
  - `README.md`: API 변경사항

- [ ] **Fixture manifest 추가**
  - `fixtures/manifest-conflict-reject.json`
  - `fixtures/manifest-conflict-isolate.json`
  - `fixtures/manifest-invalid-conflict-policy.json` (fail case)

## 3단계: Test & Verify

### 단위 테스트 (Rust)

**packages/core-rust/tests/schema.rs**
```rust
#[test]
fn test_schema_reject_incompatible_version() {
  let current = Schema { version: "1.0.0".to_string(), ... };
  let incoming = Schema { version: "2.0.0".to_string(), ... };
  
  let result = validate_schema_compatibility(&current, &incoming, ConflictPolicy::Reject);
  assert!(matches!(result, Err(StoreError::SchemaConflict(_))));
}

#[test]
fn test_schema_isolate_creates_separate_store() {
  // Isolation이 실제로 store를 분리했는지 확인
}
```

### 통합 테스트 (TypeScript)

**packages/core/src/auto-store.test.ts**
```typescript
describe('Store.attachWithConflict', () => {
  it('rejects incompatible schema with STORE_CONFLICT error', async () => {
    const store1 = createStore({ schema: v1 });
    const store2 = createStore({ schema: v2, conflict: 'reject' });
    
    await expect(() => store2.attach(store1)).rejects.toThrow('STORE_CONFLICT');
    expect(store1.auditLog).toContainEvent('store:conflict-rejected');
  });
  
  it('isolates incompatible schema without sharing state', async () => {
    const store1 = createStore({ name: 'shared', schema: v1 });
    const store2 = createStore({ name: 'shared', schema: v2, conflict: 'isolate' });
    
    store1.setState({ count: 1 });
    expect(store2.getSnapshot().count).toBeUndefined();
    expect(store2.auditLog).toContainEvent('store:attached-isolated');
  });
  
  it('fails on attach when conflict policy field is missing', async () => {
    const manifest = loadFixture('manifest-missing-conflict.json');
    await expect(() => validateManifest(manifest)).rejects.toThrow('INVALID_MANIFEST');
  });
});
```

### Framework Adapter Test (React)

**packages/frameworks/react/__tests__/useGaesup.test.tsx**
```typescript
describe('useGaesup with conflict handling', () => {
  it('throws when store has conflict', () => {
    const store = createIsolatedStore();
    store.simulateConflict();
    
    const { result } = renderHook(() => useGaesup(store));
    expect(result.current).toThrow('Store conflict');
  });
});
```

### Fixture 검증

**fixtures/manifest-conflict-reject.json**
```json
{
  "name": "order-agent",
  "stores": [
    {
      "id": "orders",
      "schema": "v2.0.0",
      "conflict": "reject"
    }
  ]
}
```

✓ Validator를 통과하는가?
✓ Runtime에서 실제로 reject되는가?
✓ Audit log에 error code가 있는가?

**fixtures/manifest-invalid-conflict-policy.json** (negative case)
```json
{
  "name": "bad-agent",
  "stores": [
    {
      "id": "orders",
      "conflict": "unknown-policy"
    }
  ]
}
```

✗ Validator를 통과하지 말아야 함
✓ 명확한 error message

### 실행 명령

```bash
# Rust 테스트
cargo test -p gaesup-core-rust schema::

# TypeScript 테스트
pnpm --filter gaesup-state run test auto-store.test.ts

# React adapter 테스트
pnpm --filter @gaesup-state/react run test useGaesup

# 전체 스위트 (배포 전)
pnpm run test:ci
```

## 4단계: QC & Regression Check

### 실행 체크리스트

- [ ] **단위 테스트 통과**
  ```bash
  cargo test -p gaesup-core-rust
  pnpm run test
  ```

- [ ] **Fixture 검증**
  - 모든 fixture manifest가 validator 통과 또는 실패
  - 예제 manifest와 runtime 동작 일치

- [ ] **Error code 감사**
  - 새 error code가 `STORE_ERRORS` enum에 정의됨
  - 테스트에서 해당 error code 확인
  - 문서에 설명됨

- [ ] **Audit/Timeline event 확인**
  - 예상되는 audit event (예: `store:conflict-rejected`)가 timeline에 기록됨
  - operator가 읽을 수 있는 형식

- [ ] **회귀 테스트**
  - 기존 store 동작 변경 없음
  - 기존 adapter mount/unmount 동작 변경 없음
  - 성능 벤치마크 회귀 확인 (측정값 있으면)

### QC 예제 체크리스트 (Store Schema Conflict 라운드)

```
✓ Rust 테스트 3개 통과 (compatibility check, isolation, fixture validation)
✓ TS 테스트 5개 통과 (reject, isolate, mount/unmount cleanup, error propagation)
✓ React adapter 테스트 2개 통과 (error handling, state isolation)
✓ Fixture manifest 4개:
  - reject 정책 (valid)
  - isolate 정책 (valid)
  - 잘못된 정책명 (invalid, 검증 거부)
  - 누락된 schema (invalid)
✓ Error code: STORE_CONFLICT, STORE_ISOLATED 정의됨
✓ Audit event: store:conflict-rejected, store:attached-isolated 기록됨
✓ 기존 카운터 공유 테스트 회귀 없음 ✓
✓ Framework adapter (React/Vue/Svelte) mount/unmount cleanup 회귀 없음 ✓
✓ 성능 벤치마크: Jotai와 동일 또는 향상 ✓
```

## 5단계: Code Quality (No-op 범위)

### DRY: Fixture 중복 제거

라운드마다 보조 목표로 처리:

- [ ] **Schema 정의 통일**
  - 같은 schema를 여러 테스트 파일에서 정의하지 말 것
  - 공통 schema를 `fixtures/schemas.ts`에서 import

**Before:**
```typescript
// auto-store.test.ts
const orderSchema = { version: '1.0.0', fields: { id: 'string' } };

// conflict-policy.test.ts
const orderSchema = { version: '1.0.0', fields: { id: 'string' } };  // 중복
```

**After:**
```typescript
// fixtures/schemas.ts
export const SCHEMAS = {
  ORDER_V1: { version: '1.0.0', fields: { id: 'string' } },
  ORDER_V2: { version: '2.0.0', fields: { id: 'string', status: 'enum' } },
};

// auto-store.test.ts, conflict-policy.test.ts 모두
import { SCHEMAS } from '../fixtures/schemas';
```

- [ ] **Manifest fixture 조직**
  - `fixtures/manifest-*.json` 네이밍 규칙 통일
  - `fixtures/README.md`에 각 fixture의 용도 설명

- [ ] **Test naming 개선**
  - test description은 "what failed" 아닌 "what behavior" 설명
  - ❌ `test_schema_conflict` → ✓ `test_schema_conflict_policy_reject_blocks_incompatible_version`

## 6단계: Loop 진입

### 다음 라운드 시작 조건

- [ ] QC 체크리스트 전부 통과
- [ ] 회귀 테스트 통과
- [ ] 새 계약이 기존 adapter/manifest와 호환성 확인
- [ ] 문서 최신화 완료

### 루프 패턴 (지속 개선)

각 라운드는 이전 라운드의 피드백을 반영:

1. **1주기**: Container manifest validation ✅ 완료 (2026-08-02)
   - `hash`, `signature`, `ABI version` 검증
   - ABI 검증: `ABI_VERSION_MISMATCH` (기존부터 존재)
   - Integrity hash 검증 (Rust `validate_integrity`, `packages/core-rust/src/compatibility.rs`):
     manifest `integrity.hash` (`<algo>-<hexdigest>`, sha256/sha384/sha512), host `requireIntegrity`
     플래그. 에러 코드 `MANIFEST_INTEGRITY_MISSING`, `MANIFEST_HASH_INVALID`. fail-closed.
   - Signature 검증 (Rust `validate_signature`): manifest `integrity.signature`
     (`<scheme>-<base64>`, ed25519/ecdsa-p256/rsa-sha256), host `requireSignature` 플래그
     (requireIntegrity와 직교). 에러 코드 `MANIFEST_SIGNATURE_MISSING`, `MANIFEST_SIGNATURE_INVALID`.
     fail-closed.
   - Audit: `CompatibilityGuard.validate`(인스턴스/static)가 성공/실패 모두
     `manifest:validated` 이벤트를 runtime timeline에 기록 (details: manifest name, valid, errorCodes)
   - 테스트 현황: Rust 네이티브 49개, TS(vitest) 57개 green

2. **2주기**: Store schema conflict handling ✅ 완료 (2026-08-02)
   - `reject`, `isolate` 정책 구현
   - Audit: `store:conflict-rejected` 이벤트 — `applyManifestStorePolicies`가
     `STORE_SCHEMA_CONFLICT` 검증 에러별로 store 단위 기록 (storeId, message, manifest name)
   - Isolate 상태 격리 보장: dispatch/select 레벨 테스트로 원본 store 무공유 검증
     (`resolveReadStoreId`/`resolveWriteStoreId` 리다이렉트, `store:isolated` 이벤트,
     manifest 경유 `STORE_SCHEMA_ISOLATED` end-to-end). 구현 갭 없음 — 회귀 방어 테스트
   - 참고: readonly 강제(`STORE_READONLY_WRITE_DENIED`), shadow/dual-write/migrate
     정책은 이전부터 구현·테스트됨
   - 테스트 현황: TS(vitest) 63개, Rust 네이티브 49개 green

3. **3주기**: Permission & import validation ✅ 완료 (2026-08-02)
   - `allowedImports` 강제
   - Capability registry
   - `allowedImports` 검증기 (Rust `validate_allowed_imports`): 형식 검사
     `MANIFEST_IMPORTS_INVALID`, host `allowedImports` allowlist 대조
     `IMPORT_NOT_ALLOWED` (import별, trim-then-exact match). fail-closed.
   - `permissions` capability registry 검증기 (Rust `validate_permissions`): known
     registry(network/storage/dom/crossStore/crossContainer/effects),
     `MANIFEST_PERMISSIONS_INVALID` / `PERMISSION_UNKNOWN_CAPABILITY`(키별) /
     host `allowedPermissions` 미승인 시 `PERMISSION_NOT_GRANTED`. 비활성 값(false,
     "none", 빈 배열, {enabled:false}, {mode:"none"})은 요청 아님. fail-closed.
   - 검증기-런타임 계약 테스트: `assertAllowedWasmImports`(micro-sandbox)와 검증기의
     allowlist 의미(trim-then-exact) 동기화를 vitest 계약 테스트 3개로 고정.
   - 갭 해소 (1d9be69): 런타임 매칭을 명시적 쌍 형식(`module.name`/`module/name`/
     `module:name`)으로 축소, 단독 매칭 제거. 계약 테스트가 새 의미 고정.
   - 테스트 현황: TS(vitest) 78개, Rust 네이티브 61개 green.

4. **4주기**: Machine runtime (flat states) ✅ 완료 (2026-08-02)
   - State, event, transition, guard, action
   - Snapshot/rollback
   - `machine:transitioned` audit 계약 테스트 완료 (거부 전이
     TRANSITION_NOT_FOUND/GUARD_REJECTED, rollback, 수락 payload — 구현 갭 없음).
   - Rust fail-closed 경로 네이티브 테스트 가능화 (f4032a1): send/rollback 로직을
     순수 코어(`init_machine_instance`/`send_machine_core`/`rollback_machine_core`)로
     추출(동작 불변, wasm 래퍼는 직렬화·조회만). FINAL_STATE 거부·
     `ROLLBACK_CHECKPOINT_NOT_FOUND`·rollback 복원·checkpointLimit eviction
     네이티브 테스트 4개.
   - 테스트 현황: Rust 네이티브 65개, TS(vitest) 78개 green.

5. **5주기**: Metrics & observability ✅ 완료 (2026-08-02)
   - Store, container, machine 단위 metrics
   - DevTools timeline 연동
   - `get_machine_metrics` (Rust 순수 집계 `machine_metrics` + thin 래퍼, TS
     `getMachineMetrics`/`MachineMetricsSnapshot`): transitionCount/avg/
     maxDurationMs. fail-closed 관측성 — 표본 없으면 null(0으로 위장 금지),
     `historyAvailable`/`historyTruncated`로 부분 표본 명시.
   - timeline 드롭 카운터: 500개 절단을 `droppedTimelineEventCount`로 노출
     (무음 손실 제거). `subscribeRuntimeTimeline` push 채널 — 리스너 예외
     격리 + `TIMELINE_LISTENER_ERROR` 기록(재귀 방지), 해제 함수 반환.
   - `getRuntimeMetrics`에 `machines` 축 추가 (`list_machine_metrics`, 집계
     로직 단일 소스 재사용).
   - 테스트 현황: Rust 네이티브 71개, TS(vitest) 86개 green.
   - 잔여: React 등 어댑터의 runtime metrics 소비 훅(폴링 대신 구독 채널
     사용), DevTools 브리지-예제 시그니처 불일치, ContainerMetrics 타입
     계약 미고정.

6. **6주기**: Reactive dependency graph (state/derived/batch) ✅ 완료 (2026-08-15)
   - Runtime Spec v0.1 §16-20 / MVP 0.1 대응 — 순수 JS 그래프 엔진
     (`packages/core/src/graph.ts`, WASM 경계 없음)
   - `state()`: get/set(updater 지원)/subscribe, 단조 증가 version, 동일 값
     set은 no-op (custom `equals` 지원)
   - `derived()`: 실행 중 자동 의존성 수집, lazy 평가 + 캐싱, dynamic
     retracking (분기 전환 시 안 읽는 dep 변경은 재계산·알림 없음), 값
     불변 시 version 미증가로 downstream 전파 차단 (cutoff)
   - Dirty propagation: affected subgraph만 재계산 (O(affected)),
     diamond glitch-free (알림 1회, 일관된 값)
   - `batch()`: 다중 set → 알림 1회, 중첩 batch는 최외곽에서 flush,
     콜백 throw에도 flush 보장, batch 내 revert 시 알림 생략
   - Fail-closed: 순환 의존 시 `DependencyCycleError`
     (`GAESUP_DEPENDENCY_CYCLE`, 순환 경로 포함), compute 실패 시
     미초기화 유지 → 다음 read에서 재시도
   - 테스트 현황: TS(vitest) 106개 green (graph 20개 신규), 타입체크 green.
   - 잔여: expose/consume을 그래프 노드 계약으로 연결, Rust
     diff/serialization 가속 여부 결정

7. **7주기**: Graph-native resource (`graphResource`) ✅ 완료 (2026-08-15)
   - Runtime Spec v0.1 §21-24 / MVP 0.2 대응 — 공개 `state`/`derived` API만
     조합한 순수 그래프 구현 (`packages/core/src/graph-resource.ts`)
   - key가 derived 노드: `key()` 안에서 읽은 state가 자동 추적되어 변경 시
     자동 refetch (§71 "useEffect 불필요" 구조 성립). key는 JSON deep-equal
     비교 — 값이 같으면 refetch 없음, 무관한 state 변경도 refetch 없음
   - Lazy activation: 첫 get/subscribe 전에는 fetch하지 않음
   - Fail-closed: fetch 거부 시 status 'error' + error 노출(silent fail
     없음), key 변경 시 재시도 후 error 해제. stale response는 fetch 시퀀스
     가드로 폐기 (최신 fetch만 상태 소유)
   - 그래프 통합: resource 상태가 state 노드라 derived가 `res.get().data`를
     추적 가능 — 데이터 도착 시 downstream 재계산·알림
   - `refetch()` escape hatch (현재 key로 수동 재실행)
   - 테스트 현황: TS(vitest) 117개 green (graph-resource 8개 신규), 타입체크 green.
   - 잔여: subscriber-count 기반 lifecycle (§41 RETAINED/DISPOSED),
     staleTime/캐시 dedup (§23), command 커밋 시 자동 invalidation (§24)

8. **8주기+**: Framework adapter robustness
   - Repeated mount/unmount
   - Error boundary
   - Memory leak 확인

각 라운드 후:
- `HARNESS.md` 이 섹션 업데이트 (진행률 표시)
- 다음 라운드 계약 정의

## 부록: 실패 경로 체크리스트

모든 테스트는 happy path만 아니라 fail-closed 경로도 검증한다.

### 테스트당 최소 요구사항

| 계약 | Happy Path | Fail-Closed Path | 예제 |
|---|---|---|---|
| Schema conflict | Accept compatible | Reject incompatible | reject policy 불가 |
| Permission | Grant allowed capability | Deny all others | allowedImports 체크 |
| ABI match | Load compatible WASM | Block mismatched ABI | ABI version diff |
| Manifest validation | Valid manifest loads | Invalid field rejected | unknown `conflict` value |
| Adapter lifecycle | mount → unmount clean | Mount fail → no subscription leak | container not found |

### 금지 사항

- ❌ "happy path만 통과하고 fail-closed는 테스트하지 않음"
- ❌ "fail case를 skip 또는 timeout으로만 처리"
- ❌ "error code 반환하지 않고 silent fail"
- ❌ "audit event 기록하지 않음"
- ❌ "fixture를 실제 runtime처럼 포장"

## 관찰 및 피드백

각 라운드 후 다음을 기록:

- **무엇이 잘 작동했는가?**
- **어느 부분이 모호했는가?** (다음 라운드에 명확히)
- **어느 부분이 너무 복잡했는가?** (단순화 기회)
- **어느 에러 코드가 operator에게 불명확했는가?** (개선)

이 피드백은 다음 라운드 설계에 반영된다.
