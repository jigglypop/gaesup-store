# Gaesup Runtime Specification v0.1

### Frontend Micro-Container Runtime + Integrated State Plane

## 0. 문서 상태

* **프로젝트명:** Gaesup
* **핵심 패키지:** `gaesup-core`, `gaesup-store`, `gaesup-runtime`
* **문서 유형:** Architecture / Runtime Specification
* **상태:** Draft v0.1
* **주요 목표:** 프론트엔드 애플리케이션을 독립적인 Micro Container 단위로 구성하고, 상태·리소스·명령·라이프사이클·의존성·격리를 Runtime 차원에서 통합 관리한다.
* **주요 대상:** React 기반 웹 애플리케이션
* **장기 대상:** Vanilla DOM, Vue, Svelte, Three.js, WebGPU, WASM

---

# 1. 프로젝트 정의

Gaesup은 단순한 상태관리 라이브러리가 아니다.

Gaesup의 기본 실행 단위는 React Component나 Page가 아니라 **Frontend Container**다.

```text
Traditional Frontend

Application
 ├─ React
 ├─ Router
 ├─ Zustand
 ├─ React Query
 ├─ API Client
 ├─ Event Bus
 └─ Components
```

Gaesup에서는 다음과 같이 분해한다.

```text
Gaesup Runtime

Application
 ├─ Auth Container
 ├─ Portfolio Container
 ├─ Trading Container
 ├─ Notification Container
 └─ AI Assistant Container
```

각 Container는 독립적으로 다음을 소유한다.

```text
Frontend Container
├─ State
├─ Derived State
├─ Resources
├─ Commands
├─ Dependencies
├─ Exposed Interfaces
├─ Runtime Configuration
├─ Lifecycle
└─ Renderer
```

따라서 Gaesup의 핵심 정의는 다음과 같다.

> **Gaesup은 프론트엔드 애플리케이션을 독립적인 Micro Container 단위로 실행하고 조합하기 위한 Runtime이며, Gaesup Store는 Container 사이의 상태·리소스·명령·의존성을 관리하는 내장 State Plane이다.**

---

# 2. 설계 목표

## 2.1 주요 목표

### G1. Frontend 실행 단위 분리

프론트엔드 코드를 Container 단위로 분리한다. 각 Container는 독립적인 lifecycle과
state namespace를 가진다.

### G2. State Management 통합

Local state(Zustand/Redux), Server state(React Query), Realtime(WebSocket),
Persistence(localStorage)를 하나의 State Graph로 표현한다:
State / Resource / Derived / Stream / Command.

### G3. 명시적인 Container Interface

Container 간 직접 import 또는 global state 공유를 최소화한다.
Container A가 `exposes: user, logout` → Container B가 `consumes: auth.user, auth.logout`.
Runtime이 의존성을 연결한다.

### G4. Lifecycle과 React 분리

Container lifecycle은 React lifecycle에 종속되지 않는다.
CREATED → RESOLVING → READY → ACTIVE → SUSPENDED → STOPPED → DESTROYED.
React Component의 mount/unmount는 Container 상태와 별개의 개념이다.

### G5. Framework-independent Core

Gaesup Core는 React를 모른다. 초기 구현만 React Adapter를 제공한다.

---

# 3. 명시적 비목표

V1에서 다음 기능은 구현하지 않는다.

* Kubernetes 자체 구현 / Docker 수준 OS isolation / 자체 JavaScript VM /
  자체 브라우저 sandbox / 서버 분산 transaction / Kafka broker 구현 /
  Backend framework / React replacement / 자체 virtual DOM /
  Agent orchestration platform / RBAC·ABAC 전체 엔진 / 자체 package registry

장기 확장 가능성은 남겨두되 Core에는 포함하지 않는다.

---

# 4. 전체 아키텍처

```text
Application
 └─ Containers (Auth, Trading, Chat, …)
      └─ Container Mesh
           └─ State Plane (State / Derived / Resource / Command / Stream / Transaction)
                └─ Dependency Graph
                     └─ Gaesup Runtime
                          └─ Platform Adapter (React / Browser API / WASM)
```

---

# 5. 패키지 구조

권장 Monorepo 구조:

```text
packages/
├─ core/      graph, scheduler, lifecycle, transaction, types
├─ store/     state, derived, resource, command, stream, persistence
├─ runtime/   container, registry, resolver, loader, policies
├─ react/
├─ devtools/
├─ cli/
└─ manifest/
```

배포 패키지: `@gaesup/core`, `@gaesup/store`, `@gaesup/runtime`, `@gaesup/react`,
`@gaesup/devtools`, `@gaesup/cli`.

---

# 6. Container

Container는 Gaesup의 최소 애플리케이션 실행 단위다.

```ts
const auth = defineContainer({
  name: "auth",
  state: () => ({ user: state<User | null>(null), authenticated: derive(...) }),
  resources: () => ({ session: resource(...) }),
  commands: () => ({ login: command(...), logout: command(...) }),
  exposes: ({ state, commands }) => ({ user: state.user, login: commands.login, logout: commands.logout }),
  view: AuthView
})
```

---

# 7. Container Identity

```ts
interface ContainerIdentity { name: string; version?: string; instance?: string }
```

예: `auth@1.2.0`. 동일 Container의 여러 instance도 가능하게 설계한다
(`chart/BTC`, `chart/ETH`). 논리 주소: `gaesup://chart/BTC`.

---

# 8. Container Namespace

모든 상태는 Container namespace 안에 존재한다: `auth.user`, `portfolio.assets`.
내부적으로 canonical address: `gaesup://auth/state/user`.

---

# 9. Container Isolation

V1의 Isolation은 OS isolation이 아니라 **논리적 runtime isolation**이다.

## 9.1 State Isolation
다른 Container의 내부 상태를 직접 변경할 수 없다.
금지: `auth.state.user.set(...)` / 허용: `auth.commands.login(...)`
또는 expose된 writable interface만 접근.

## 9.2 Import Isolation
금지: `import { userState } from "../auth/internal"` / 권장: `consume("auth.user")`

## 9.3 Failure Isolation
각 Container 실행은 Error Boundary를 가진다. A crash → Runtime marks A = FAILED,
B/C는 계속 실행.

---

# 10. Container Lifecycle

```ts
type ContainerStatus =
  | "CREATED" | "RESOLVING" | "READY" | "STARTING" | "ACTIVE"
  | "SUSPENDED" | "STOPPING" | "STOPPED" | "FAILED" | "DESTROYED"
```

정상 흐름: CREATED → RESOLVING → READY → STARTING → ACTIVE → SUSPENDED → ACTIVE
→ STOPPING → STOPPED → DESTROYED.

---

# 11. Runtime API

```ts
const runtime = createRuntime()
runtime.register(container); runtime.unregister(name)
runtime.start(name); runtime.stop(name)
runtime.suspend(name); runtime.resume(name)
runtime.mount(name, target); runtime.unmount(name)
runtime.get(name); runtime.inspect(name)
```

---

# 12. Container Registry

`runtime.containers()` → `[{ name, status, version }]`

---

# 13. Dependency Resolution

```ts
defineContainer({ name: "portfolio", consumes: { user: consume("auth.user"), prices: consume("market.prices") } })
```

Runtime은 DAG를 생성한다. Dependency cycle은 기본적으로 오류:
**`GAESUP_DEPENDENCY_CYCLE`**.

---

# 14. Expose / Consume Model

외부 공개 API는 반드시 명시한다. 외부에서는 `consume("auth.user")`로 접근.
Container 내부 refactoring과 외부 contract를 분리한다.

---

# 15. State Plane

Gaesup Store의 primitive: **state / derived / resource / command / transaction / stream**.

---

# 16. State

```ts
const count = state(0)
count.get(); count.set(10); count.subscribe(fn)
interface StateNode<T> { id: NodeID; value: T; version: number }
```

---

# 17. Derived State

```ts
const doubled = derived(() => count.get() * 2)
```

Runtime은 실행 중 dependency를 자동 수집한다. `count`가 변하면 `doubled`만 dirty.

---

# 18. Dependency Graph

그래프 엔진 책임: dependency 등록 / edge 제거 / dirty propagation /
topological evaluation / cycle detection / incremental recomputation.

---

# 19. Dirty Propagation

A changed → mark dependencies dirty → find affected subgraph → topological recompute.
목표: O(Application) → **O(Affected Subgraph)**.

---

# 20. Scheduler

Mutation → Collect changes → Mark dirty → Resolve graph → Compute derived →
Notify subscribers → Render. 동일 event loop 내 다중 변경은 batch:

```ts
batch(() => { a.set(1); b.set(2); c.set(3) })  // 구독자에는 한 번만 알림
```

---

# 21. Resource

```ts
const user = resource({
  key: () => ["user", userId.get()],
  fetch: async ([, id]) => api.get(`/users/${id}`),
  staleTime: 30_000
})
type ResourceStatus = "idle" | "loading" | "success" | "error" | "stale"
```

---

# 22. Resource가 Graph Node인 이유

`userId` 변경 → Resource key 변경 → Runtime이 자동으로 새 Resource resolve.
사용자가 `useEffect(...)`를 작성할 이유가 없다.

---

# 23. Resource Cache

Cache key: `resource-type + normalized-key` (예: `users:["user",42]`).
지원: deduplication / stale time / GC / ref counting / cancellation / retry /
cache hydration / prefetch.

---

# 24. Automatic Invalidation

명시적 invalidate는 escape hatch. 기본: Command → State/Resource changed →
Dependency Graph → Affected Resource detection → Revalidate.

---

# 25. Command

```ts
const renameUser = command({ execute: async ({ id, name }) => api.patch(`/users/${id}`, { name }) })
```

Command pipeline: Input → Validation → Optimistic Transition → Execute → Commit or Rollback.

---

# 26. Optimistic Update

```ts
command({
  optimistic({ id, name }) { users.patch(id, { name }) },
  execute(input) { return api.renameUser(input) }
})
```

성공: Optimistic → Remote Success → Commit. 실패: → Rollback.

---

# 27. Transaction

```ts
transaction(() => { balanceA.set(balanceA.get() - 100); balanceB.set(balanceB.get() + 100) })
```

외부 observer는 중간 상태를 보지 않는다.

---

# 28. Transaction 내부 구조

```ts
interface Transaction { id: string; writes: WriteSet; status: "OPEN" | "COMMITTED" | "ROLLED_BACK" }
```

V1에서 transaction은 local runtime 범위까지만. 분산 ACID는 지원하지 않는다.

---

# 29. Stream

```ts
const notifications = stream({ subscribe(observer) { return socket.subscribe(observer) } })
```

Adapter: WebSocket / SSE / BroadcastChannel / EventTarget / RxJS / Custom.
Kafka는 서버 proxy나 custom adapter로.

---

# 30. Stream → State

price stream → market.price updated → portfolio.value recomputed → UI notified.
예: `marketPrices.connect(priceStream)`.

---

# 31. Persistence

```ts
const theme = state("dark", { persist: indexedDB("theme") })
```

기본 adapter: localStorage / sessionStorage / IndexedDB / Memory. Custom:
`createPersistenceAdapter(...)`.

---

# 32. React Adapter

패키지 `@gaesup/react`. 최소 API:

```ts
useGaesup(node); useResource(resource); useContainer(name)
```

내부 구현은 가능한 경우 `useSyncExternalStore` 기반.

---

# 33. React와 Container Lifecycle 분리

React mount = Container start 구조는 **금지**. Container는 ACTIVE인 채 React View가
mount/unmount를 반복할 수 있다.

---

# 34. View

Container는 View를 선택적으로 가진다. Headless Container 가능 (`view: null`).

---

# 35. Renderer 추상화

```ts
interface Renderer { mount(...); update(...); unmount(...) }
```

구현: ReactRenderer / DOMRenderer / ThreeRenderer / CanvasRenderer / WebGPURenderer.

---

# 36. Container Manifest

```yaml
apiVersion: gaesup/v1
kind: Container
metadata: { name: portfolio, version: 1.2.0 }
runtime: { type: javascript }
entry: { module: ./dist/index.js }
state: { scope: isolated }
exposes: [portfolio, selectedAccount, refresh]
consumes: [auth.user, market.prices]
permissions: { network: ["/api/portfolio/*"] }
```

V1에서는 모든 manifest 항목을 실제 강제하지 않아도 된다. 미래 contract를 고려해
스키마는 미리 정의한다.

---

# 37. Package Artifact

장기: `portfolio.gsp` (manifest.json, entry.js, styles.css, assets/, schema/).
초기에는 일반 npm/package bundle 활용.

---

# 38. Dynamic Loading

```ts
await runtime.load({ manifest: "/containers/portfolio.json" })
```

Flow: manifest → validate → dependency resolve → module fetch → register → ready.

---

# 39. Mount

```ts
runtime.mount("portfolio", document.querySelector("#portfolio"))
```

Renderer가 없는 Container는 mount할 수 없다.

---

# 40. Suspend

```ts
runtime.suspend("portfolio"); runtime.resume("portfolio")
```

Suspend 기본 정책: renderer pause / realtime subscription pause 가능 / state 유지 /
resource cache 유지 / command 신규 실행 제한 가능.

---

# 41. Resource Lifecycle

subscriber 기준: 0 subscriber → INACTIVE / first → ACTIVE / last gone → RETAINED /
retention timeout → DISPOSED.

---

# 42. Health Model

```ts
type Health = "healthy" | "degraded" | "failed"
```

영향 요소: dependency failure / startup exception / resource repeated failure /
runtime invariant violation.

---

# 43. Failure Boundary

```ts
runtime.onContainerError((error) => ...)
interface ContainerError { container: string; phase: string; cause: Error; timestamp: number }
```

---

# 44. Dependency Failure

```ts
consume("auth.user", { required: true })   // unavailable → DEGRADED/FAILED
consume("recommendation.data", { required: false })  // 없어도 계속 실행
```

---

# 45. Container Communication

세 가지 primitive: **State**(읽기 중심 reactive), **Command**(상태 변경 요청),
**Stream**(시간순 event). 별도 global Event Bus를 핵심 primitive로 두지 않는다.

---

# 46. 직접 Mutation 금지

`Portfolio → Auth.user = X` 금지. `Auth.updateUser(...)` Command 사용.
invariant를 Container 내부에 유지한다.

---

# 47. Configuration

```ts
defineContainer({ config: { currency: "KRW" } })
runtime.start("portfolio", { config: { currency: "USD" } })
```

---

# 48. Environment

```ts
createRuntime({ env: { API_URL: "...", STAGE: "production" } })
// Container에서: context.env.API_URL
```

---

# 49. Permission Model V1

capability 목록 정도만 (metadata 역할). 향후 Worker/WASM isolation에서 실제
enforcement로 확장.

---

# 50. Container Context

```ts
defineContainer((ctx) => { ctx.container; ctx.runtime; ctx.env; ctx.consume; ctx.logger })
```

내부 Runtime 객체 전체를 노출하면 coupling — public API는 제한한다.

---

# 51. Logging

Container별 namespace logging: `[gaesup:auth]`. `ctx.logger.info("container started")`.

---

# 52–53. Trace

모든 주요 변화를 trace. causal chain은 parent id로 추적.

```ts
interface TraceEvent {
  id: string; timestamp: number; container: string
  type: "state-change" | "resource-fetch" | "command" | "transaction" | "lifecycle" | "render"
  parent?: string; payload?: unknown
}
```

---

# 54–55. DevTools / Graph Inspector

화면: Containers / Graph / State / Resources / Commands / Transactions / Trace /
Performance. "왜 이 UI가 업데이트됐지?"를 추적 가능해야 한다.

---

# 56. Time Travel

T0 → T1 → T2 → T3 이동. Resource side effect의 완전한 rewind는 보장하지 않는다.
State snapshot 수준의 replay 우선.

---

# 57. Snapshot

```ts
const snapshot = runtime.snapshot()
runtime.restore(snapshot)
runtime.snapshot({ containers: ["auth", "portfolio"] })
```

---

# 58–59. SSR / Hydration

Container 자체는 DOM을 직접 참조하면 안 된다. State/Resource/Command/Container는
server compatible, Renderer만 플랫폼 종속. Server: state → snapshot → HTML.
Client: snapshot → runtime.restore → React hydration.

---

# 60. Worker Isolation (V2+)

Container를 Web Worker에서 실행. Main Thread(React Renderer) ↔ Message Channel ↔
Worker Container. State Plane Protocol로 통신.

---

# 61. WASM Core

V1 필수 아님. 단 graph / scheduler / transaction / state diff / serialization /
dependency resolution은 WASM 이전 가능하도록 pure runtime logic으로 구현한다.

---

# 62–63. Container Transport Protocol

```ts
type RuntimeMessage = StateUpdate | CommandRequest | CommandResponse | Subscribe | Unsubscribe | LifecycleMessage
```

```json
{ "type": "state:update", "container": "auth", "node": "user", "version": 42, "value": { "id": 123 } }
```

초기 로컬 구현은 serialization 없이 직접 객체 참조를 쓰되 protocol boundary는 유지.

---

# 64. Versioning

State node version: monotonically increasing integer. stale update 탐지에 사용.

---

# 65–67. CLI

초기: `gaesup create / dev / build / inspect`. 향후: `run / pack / graph`.
`gaesup create portfolio` → container.ts, state.ts, resources.ts, commands.ts,
view.tsx, manifest.yaml.

---

# 68. 권장 코드 구조

```text
src/containers/
├─ auth/ { container.ts, state.ts, commands.ts, resources.ts, view.tsx }
├─ market/
└─ portfolio/
```

---

# 69. 예제: Auth Container

```ts
const authContainer = defineContainer({
  name: "auth",
  setup() {
    const user = state<User | null>(null)
    const authenticated = derived(() => user.get() !== null)
    const session = resource({ key: () => ["session"], fetch: async () => api.getSession() })
    const login = command({ execute: api.login, commit(result) { user.set(result.user) } })
    const logout = command({ execute: api.logout, commit() { user.set(null) } })
    return {
      state: { user, authenticated },
      resources: { session },
      commands: { login, logout },
      exposes: { user, authenticated, login, logout }
    }
  }
})
```

---

# 70. Portfolio Container

```ts
const portfolioContainer = defineContainer({
  name: "portfolio",
  setup({ consume }) {
    const user = consume<User>("auth.user")
    const selectedAccount = state<string | null>(null)
    const portfolio = resource({
      key: () => ["portfolio", user.get()?.id, selectedAccount.get()],
      fetch: ([, userId, account]) => api.portfolio(userId, account)
    })
    const total = derived(() =>
      portfolio.get()?.assets.reduce((sum, asset) => sum + asset.value, 0) ?? 0)
    return { state: { selectedAccount, total }, resources: { portfolio } }
  }
})
```

Graph: auth.user → selectedAccount → portfolio.resource → total → PortfolioView.

---

# 71. useEffect가 필요 없는 구조

기존 `useEffect(() => { if (user && account) fetchPortfolio(...) }, [user, account])` 대신
`resource({ key: () => [user.get()?.id, account.get()], fetch })`.
Dependency를 Runtime이 발견한다.

---

# 72. Container Group (V2)

```ts
defineGroup({ name: "trading-workspace", containers: [marketChart, orderBook, orderForm, positions] })
```

Group 수준 start/suspend/stop/snapshot.

---

# 73–75. Runtime 전체 Application / Startup Ordering

```ts
const app = createRuntime({ containers: [authContainer, marketContainer, portfolioContainer, chatContainer] })
await app.start()
```

Dependency graph 분석으로 startup 순서 결정(topological scheduling).
독립 Container는 병렬 startup 가능.

---

# 76. Container Hot Replacement

```ts
runtime.replace("portfolio", newPortfolioContainer, { preserveState: true })
```

이를 기반으로 HMR 구현 가능.

---

# 77. Performance 목표

* State: 단순 read/write가 일반 JS store 대비 과도한 overhead를 만들지 않는다.
* Dependency: graph traversal은 O(affected nodes + affected edges).
* React: 변경과 무관한 Container/View는 rerender하지 않는다.
* Memory: unreferenced Resource는 GC 대상.

---

# 78–79. Container Size / 설계 기준

❌ Button/Input/Modal — ⭕ Authentication/Portfolio/Trading/Chat/Notification/AI Assistant.
Component보다 크고 application보다 작은 **도메인 실행 단위**.
후보 조건: 자체 상태 / 독립 lifecycle / 독립 배포 가능성 / 자체 API·resource /
명확한 contract / 실패 격리 / 독립 팀 ownership.

---

# 80. Micro Frontend와의 관계

MFE는 Deployment Boundary 중심. Gaesup은 Runtime + State + Lifecycle + Dependency
Boundary. Module Federation과 함께 사용 가능.

---

# 81–82. Docker / Kubernetes 대응

| Docker | Gaesup | | Kubernetes | Gaesup |
|---|---|---|---|---|
| Image | Container Package | | Pod | Container Group |
| Container | Frontend Container Instance | | Service | Exposed Interface |
| Process | Container Runtime | | Service Discovery | Dependency Resolver |
| Network | Container Mesh | | Namespace | State Namespace |
| Volume | Persistence | | ConfigMap | Container Config |
| Env | Runtime Config | | Health Probe | Container Health |
| Port | Expose/Consume Interface | | Deployment | Runtime Deployment |
| Registry | 향후 Container Registry | | Network Policy | Future Runtime Policy |

Kubernetes를 복제하는 것이 아니라 **격리·선언·조합·관찰 가능성**의 철학을 적용.

---

# 83. 가장 중요한 Runtime Invariants

* **I1** Container 내부 State는 명시적으로 expose되지 않는 한 외부에 보이지 않는다.
* **I2** 다른 Container의 State는 외부에서 직접 mutation하지 않는다.
* **I3** Dependency Graph의 cycle은 명시적으로 허용하지 않는 한 금지한다.
* **I4** Transaction commit 전 중간 State는 observer에 노출되지 않는다.
* **I5** Lifecycle 상태 전이는 정의된 transition만 허용한다.
* **I6** Resource는 React lifecycle에 종속되지 않는다.
* **I7** Renderer는 Container Runtime의 필수 요소가 아니다.
* **I8** Core는 React에 의존하지 않는다.

---

# 84. MVP 0.1

구현: defineContainer / createRuntime / state / derived / expose / consume /
React Adapter.

수용 시나리오:

```text
Auth Container exposes user
Dashboard Container consumes auth.user
auth.user 변경
→ dashboard derived 갱신
→ DashboardView만 rerender
```

---

# 85–89. MVP 로드맵

* **0.2**: resource, cache, automatic dependency tracking, automatic refetch —
  "React Query 없이 서버 상태 관리".
* **0.3**: command, transaction, optimistic update, rollback.
* **0.4**: stream, WebSocket, SSE, remote patch.
* **0.5**: dynamic loading, container lifecycle, container health, failure isolation —
  여기서부터 Container Runtime으로 명확해진다.
* **1.0**: 위 전부 + Dependency Resolver, Lifecycle, Dynamic Loading, React Adapter,
  DevTools, CLI, Manifest. WASM은 1.0까지 필수 아님.

---

# 90–91. V2 / V3

V2 후보: Worker Container, WASM Container, Container Group, Package Artifact,
Remote Container, State sync protocol, capability isolation, registry, SSR
orchestration, persistent snapshots.

V3: Local/Worker/WASM/Remote Container를 State Plane이 transport 추상화 —
사용자는 `consume("market.price")`만 사용.

---

# 92. 최종 아키텍처

Application Runtime → Container Scheduler → Containers → Container Mesh →
State Plane → Dependency Graph → Scheduler → React / Worker / WASM.

---

# 93. 핵심 개발 원칙

1. State Library를 만들지 않는다 — State는 Runtime의 한 plane이다.
2. React Framework를 만들지 않는다 — React는 renderer다.
3. Kubernetes를 복제하지 않는다 — 필요한 개념만 가져온다.
4. Container는 Component가 아니다 — 독립적인 실행 단위다.
5. 모든 것을 Container로 만들지 않는다 — isolation 가치가 overhead보다 큰 영역만.
6. Dependency를 숨기지 않는다 — Runtime이 볼 수 있어야 한다.
7. Side Effect를 선언적 Resource/Command로 최대한 이동한다.
8. Runtime이 State 흐름을 관찰할 수 있어야 한다 — 자동 invalidation, trace, replay,
   failure isolation의 전제.

---

# 94. 핵심 차별성

State / Server Resource / Realtime Stream / Mutation / Container Dependency /
Lifecycle을 **하나의 Runtime Graph 안에서 관리**한다. 프론트엔드 전체가
"수동 callback들의 집합"에서 "선언된 Container와 Dependency Graph의 집합"으로 변한다.

---

# 95. 최종 한 문장

> **Gaesup은 Docker가 프로세스를 Container라는 실행 단위로 재정의한 것처럼, 프론트엔드 애플리케이션을 State·Resource·Command·Lifecycle을 포함한 독립적인 Micro Container 단위로 재정의하고, 이들을 하나의 Reactive State Plane 위에서 조합하는 Frontend Container Runtime이다.**
