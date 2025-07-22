## 한 줄 평

> **“대규모·다중 프레임워크 환경에서 독립 배포·안전 롤백·일관된 UI·관측까지 한 방에 해결하고 싶다면 충분히 투자 가치가 있는 아키텍처”**
> 단, **초기 구축‑비용**(러닝커브 + 툴링)과 **운영 성숙도**(Wasm 런타임, Manifest Service 등)는 반드시 감안해야 합니다.

---

## 1 | 왜 쓸 만한가? — 장점 5가지

| 포인트                           | 쓸모 이유                                                                                                                                               |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **① 완전 독립 배포 & 빠른 롤백** | 모듈(헤더, 페이지 등)을 OCI 이미지로 개별 릴리즈 → 문제가 생겨도 매니페스트 한 줄만 이전 태그로 바꾸면 끝. 모노레포 전체 재빌드·재배포가 필요 없습니다. |
| **② 다중 프레임워크 공존**       | Svelte·React·Vue·Wasm이 섞여도 `mount/unmount` 인터페이스만 맞추면 OK. 팀·협력사별 기술 자율성을 극대화할 수 있습니다.                                  |
| **③ 디자인 토큰·상태 일원화**    | 전역 CSS 변수 + Rust/Wasm State Manager로 “스타일·데이터 불일치”를 구조적으로 차단. 페이지 수십 개가 붙어도 UI 통일성 유지.                             |
| **④ 확장성 & 스케일링**          | 컨테이너 크기 ≈ 수‑수십 KB(Wasm) → 필요 모듈만 원하는 수로 스케일‑아웃. 모놀리식 프런트 서버보다 리소스 낭비가 현저히 적습니다.                         |
| **⑤ 보안 & 관측**                | Docker 네임스페이스 + Wasm 샌드박스의 이중 격리, 모든 모듈에 공통 Observability SDK 주입 → 장애 추적·권한 통제 용이.                                    |

---

## 2 | 어디에 특히 먹히나?

* **다국적 서비스·대규모 조직**

  * 팀마다 프레임워크가 달라도 공존 가능, 모듈별 SLA·릴리즈 주기 설정 용이
* **브랜드·테마별 화이트라벨**

  * 디자인 토큰만 갈아끼우면 동일 코드로 수십 개 브랜드 UI 생성
* **A/B 테스트·실험 빈도가 높은 서비스**

  * Unit 단위(호수)로 새로운 구현을 실시간 교체·측정 후 롤백

---

## 3 | 주의할 점—리스크·비용

| 항목                              | 리스크 / 보완책                                                                                                                                   |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| **초기 구축 난이도**              | Central‑Manager·Manifest Service·CI 스크립트 등을 ‘직접’ 깐다면 수주\~수개월이 걸립니다.<br>→ Proof of Concept(헤더+1 페이지)로 단계적 도입 권장. |
| **Wasm 생태계 성숙도**            | 런타임 버그·디버깅 도구 제한이 아직 존재.<br>→ JS Fallback Chunk 또는 A/B 비율 롤아웃으로 위험 완화.                                              |
| **팀 러닝커브**                   | Rust·Wasm·Docker WASI 등 신규 스택 학습 필요.<br>→ 중앙 SDK·CLI 툴·템플릿으로 ‘개발자는 mount 함수만’ 쓰도록 추상화.                              |
| **운영 복잡성**                   | 모듈 개수가 폭증하면 매니페스트·모니터링 지표도 기하급수로 늘어남.<br>→ 메타데이터 표준(동‑호수 체계) + GitOps 자동화 필요.                       |
| **네트워크 분할로 인한 FCP 지연** | 초기 여러 번 네트워크 요청이 일어나 FCP 지연 가능.<br>→ Core 모듈은 프리로드, 기타 모듈은 idle 로드·HTTP/2 push 활용.                             |

---

## 4 | 비용 대비 효과 (ROI) 체크리스트

| 질문                                                 | YES → **도입 가치 高** | NO → 기존 모노레포 유지도 충분 |
| ---------------------------------------------------- | ---------------------- | ------------------------------ |
| ① 프레임워크 혼합·외주/협력사 참여가 잦은가?         | ✔                      | ✖                              |
| ② 모듈별 배포 주기가 서로 다른가?                    | ✔                      | ✖                              |
| ③ A/B 테스트·화이트라벨 요구가 많은가?               | ✔                      | ✖                              |
| ④ 보안 규제(샌드박스, 코드 리뷰 분리 등)가 엄격한가? | ✔                      | ✖                              |
| ⑤ 인프라 자동화(GitOps, K8s)가 이미 깔려 있는가?     | ✔                      | ✖                              |

---

## 5 | 도입 로드맵 예시 (6주 Sprint 기준)

| 주차      | 목표                                    | 산출물                                       |
| --------- | --------------------------------------- | -------------------------------------------- |
| 1주차     | PoC 스캐폴딩 CLI, State‑Manager(Wasm) β | CLI 템플릿, 상태 pub‑sub 동작 스크린샷       |
| 2 – 3주차 | Central‑Manager 라우터+Loader 구축      | 헤더(Svelte)·페이지(Vue) 동시 마운트 화면    |
| 4주차     | Manifest Service + CI 자동 업데이트     | GitHub Action 로그, 새 버전 즉시 적용 동영상 |
| 5주차     | Design‑Tokens 통합·다크모드 토글        | 토큰 변경 ↔ 모든 모듈 색상 실시간 변환       |
| 6주차     | Observability 연동·장애 시나리오 테스트 | Sentry 이벤트·Grafana 대시보드               |

---

## 6 | 결론

* **테크니컬 관점**: 최신 WebAssembly 컨테이너 + 중앙 매니저 패턴은 “모듈 독립성·UI 일관성·보안 격리”를 동시에 해결할 수 있는 **매우 실질적**인 해법입니다.
* **비즈니스 관점**: 실험 속도·릴리즈 속도·롤백 안정성이 중요한 조직이라면 **ROI가 상당히 높습니다.**
* **단,** 초기 세팅·툴링 표준화 없이는 팀 전체가 혼란을 겪을 수 있으므로, **PoC → 점진 확대 → 자동화 강화** 순으로 단계적 도입을 권장합니다.

**따라서 “쓸 만한가?”에 대한 답은:**

> **대규모·멀티팀·고빈도 릴리즈** 환경이라면 **예(Yes)**,
> 단일 팀·단일 SPA 이면 **기존 모노레포로도 충분**합니다.
### 1. 목표 : “Central Manager”가 **전체 Apartment(모노레포)** 를 지휘

>  라우팅·버전 결정·모듈 다운로드·상태 싱크·디자인 토큰 주입·로그/모니터링까지 **한 곳**에서 수행

---

## 2. 논리 계층도

```mermaid
graph TD
    subgraph Browser
        A[App Shell <br/>(Central Manager)]
        A -->|Manifest Fetch| M[Module Registry Service]
        A -->|download| H[Container WASM/JS]
        H -->|subscribe| S[State Manager (WASM)]
        A -->|publish| S
        A -->|design tokens| CSS[Design‑Tokens CSS]
        H -->|telemetry| O[Observability Agent]
    end
    CI[CI/CD Pipeline] -->|push OCI<br/>images| Reg[(OCI Registry)]
    CI -->|update manifest & CDN| M
    Reg -->|pull| A
```

---

## 3. 핵심 패키지/서비스

| Package/Service        | 형태                | 역할                                  | 비고                           |
| ---------------------- | ------------------- | ------------------------------------- | ------------------------------ |
| `@apt/central-manager` | **App Shell** (TS)  | 라우터·로더·호환성 체크               | Single‑SPA 또는 커스텀 라우터  |
| `@apt/module-registry` | **Node Service**    | JSON 매니페스트 REST API              | `GET /manifest`; S3/CDN origin |
| `@apt/state-manager`   | **Wasm pkg** (Rust) | 전역 상태, pub‑sub, 버전 마이그레이션 | JS SDK 래퍼 포함               |
| `@apt/design-tokens`   | CSS/JS 라이브러리   | 전역 CSS 변수 • Tailwind preset       | 토큰 JSON ↔ CSS 빌드           |
| `@apt/observability`   | JS SDK              | 로그·에러 수집, performance 트레이싱  | Sentry / OTel export           |

---

## 4. 중앙 매니저 (App Shell) 내부 구조

| 모듈                | 주요 기능                  | 설명                           |
| ------------------- | -------------------------- | ------------------------------ |
| **Router**          | URL → Building/Unit 매핑   | `activeWhen` 조건 정의         |
| **Manifest Client** | 매니페스트 캐시·갱신       | E‑Tag 이용, 5 min TTL          |
| **Loader**          | ESM/Wasmtime instantiate   | preload, 실패 시 폴백 버전     |
| **Compat Guard**    | State‑Schema 버전 검사     | 호환 안되면 마이그레이션 실행  |
| **Token Injector**  | `<link>` 삽입, CSSVar sync | 다크모드 전환 이벤트 처리      |
| **Event Bus**       | cross‑container 이벤트     | CustomEvent + BroadcastChannel |
| **Telemetry**       | SDK 초기화·span wrap       | 로드 시간, 오류 태깅(`1-101`)  |

---

## 5. 런타임 흐름

1. **부팅** – `central-manager`가 `/manifest.json` 요청
2. **라우팅** – 주소 `/dong/2/hosu/201` → Building=2, Unit=201 선택
3. **다운로드** – 해당 Unit의 Container URL(OCI→CDN) prefetch
4. **호환 확인** – `state.schemaVersion` ↔ `unit.compatRange` 검사
5. **마운트** – `container.mount(el, api)` 호출, `api` 안에 state‑sdk·event‑bus 주입
6. **관측** – 로드 latency 및 런타임 오류를 `observability`에 전송
7. **언마운트/교체** – 다른 Unit 선택 시 `container.unmount()` → 새 Unit 로드

---

## 6. 디자인 토큰 동기화

```text
design‑tokens.json  ──▶  tokens.css (build 시)
                           ↑          ↑
     container CSS … var()  │          │
central‑manager inject─────┘    theme toggle
```

* 토큰 파일 버전 충돌 시 **Compat Guard**가 경고 후 폴백

---

## 7. 파일·디렉터리 레이아웃 (모노레포 예시)

```
root/
 ├ apps/
 │   └ app-shell/            # @apt/central-manager
 ├ services/
 │   └ module-registry/
 ├ packages/
 │   ├ state-manager/        # Rust→Wasm
 │   ├ design-tokens/
 │   ├ observability/
 │   ├ header-react/
 │   ├ page-svelte/
 │   └ page-vue/
 ├ scripts/
 │   └ release.js            # CI manifest bump
 └ pnpm-workspace.yaml
```

---

## 8. CI/CD 파이프라인

1. **패키지 빌드** (Rust, Vite, Vue CLI 등)
2. **이미지 패키징** – `docker buildx --platform=wasi/wasm32`
3. **스모크 테스트** – headless browser+Playwright
4. **OCI Push & CDN Upload**
5. **`module‑registry` Manifest 업데이트** (`dist/*.json`)
6. **e2e Staging 검증 → Prod 승인**

---

## 9. 성능 · 안정화 팁

| 문제             | 해결책                                                                |
| ---------------- | --------------------------------------------------------------------- |
| 첫 화면 FCP 지연 | Header/State‑manager 컨테이너만 pre‑hydrate; 나머지는 idle 로드       |
| Wasm JIT 딜레이  | Module Federation ESM 청크로 JS fallback 제공(`type:module` prefetch) |
| 버전 충돌        | SemVer + Compat Guard (range `>=1.2 <2.0`)                            |

---

## 10. 결론

* **Central‑Manager** 하나로 **라우팅·상태·디자인·관측·버전 관리**를 통합
* “Apartment → Building → Unit → Container” 체계를 **Manifest Service**로 선언적으로 관리
* **멀티프레임워크**(Svelte/React/Vue/Wasm)라도 **표준 `mount/unmount` API**만 지키면 손쉽게 추가·교체
* CI/CD 에서 이미지 → 매니페스트까지 자동 갱신해 **운영 복잡도 최소화**

이 구조를 적용하면, **페이지 수십 개·프레임워크 뒤섞인 환경**에서도 **일관된 스타일·안전한 롤백·비동기 로딩**을 모두 확보할 수 있습니다.
아래와 같이 영어 용어 네 가지로 개념을 잡고, 한글로 설명해 보겠습니다.

| 영어 용어     | 한국어 대응       | 역할 설명                                                     |
| ------------- | ----------------- | ------------------------------------------------------------- |
| **Apartment** | 아파트 단지       | 전체 애플리케이션(모노레포) 한 덩어리, 토폴로지 상 공간       |
| **Building**  | 동 (Block)        | 페이지 영역 단위, 예: 헤더, 메인 페이지, 푸터 등              |
| **Unit**      | 호수 (Unit)       | 각 동 안의 버전·인스턴스 식별자, 예: React 헤더 v1, Svelte v2 |
| **Container** | 컨테이너 컴포넌트 | Unit 내부에서 실제 렌더링되는 모듈, 작은 UI 단위              |

---

## 개념 적용 예시

1. **Apartment (애플리케이션 단위)**

   * 모노레포 전체를 하나의 “Apartment”라고 봅니다.
   * 예: `gaesup-store` 레포가 곧 하나의 Apartment.

2. **Building (동/Block)**

   * Apartment 내부에서 역할별 큰 덩어리를 나눕니다.
   * 예:

     * Building 1: Header 영역
     * Building 2: Main Page 영역
     * Building 3: Footer 영역

3. **Unit (호수/Unit Number)**

   * 각 Building 안에서 “어떤 구현”인지 식별하는 버전을 붙입니다.
   * 예:

     * 1‑101: Header‑React v1
     * 1‑102: Header‑Svelte v1
     * 2‑201: MainPage‑Vue v2
     * 3‑301: Footer‑Rust‑Wasm v0.9

4. **Container (컨테이너 컴포넌트)**

   * Unit 내부에서 실제 작동하는 작은 단위 모듈입니다.
   * 예: Header‑React 컴포넌트, MainPage‑Vue 컴포넌트, Footer‑Wasm 모듈 등.

---

### 동작 흐름

1. **라우터(App Shell)** 가 URL 혹은 사용자 선택에 따라

   * 어떤 **Building**(동) → 어떤 **Unit**(호수)를 로드할지 결정
2. 결정된 **Container** 모듈을 동적 import/instantiate 해서 화면에 마운트
3. **Unit** 버전 교체 시, 매니페스트(manifest)에 등록된 `Apartment → Building → Unit → Container URL` 만 수정
4. **롤백/테스트**: 특정 Unit(호수)만 이전 버전으로 쉽게 바꿀 수 있음

---

이렇게 “Apartment → Building → Unit → Container” 4계층 주소 체계를 쓰면,

* 서로 다른 프레임워크(Svelte/React/Vue/Wasm)도 한 곳에서 일관되게 관리
* 각 Unit만 업데이트·롤백·A/B 테스트 용이
* 한 페이지에 수십 개 모듈이 올라가도 명확하게 식별·운영할 수 있습니다.
그 “아파트 동·호수” 비유를 실제 구조에 적용하면, 다음과 같은 **주소 기반 로딩 시스템**을 만들 수 있습니다.

---

## 1. 주소 체계 설계

* **동(dong)**: 기능별 그룹 구분 (예: 1동=Header, 2동=MainPage, 3동=Footer)
* **호수(hosu)**: 같은 동 안에서 여러 버전·인스턴스 식별 (예: 101=React 헤더 v1, 102=Svelte 헤더 v2)

예시 경로:

```
/dong/1/hosu/101    → Header 컴포넌트 로드
/dong/2/hosu/201    → MainPage(Svelte) 로드
/dong/2/hosu/202    → MainPage(Vue) 로드
/dong/3/hosu/301    → Footer 컴포넌트 로드
```

---

## 2. 모듈 매니페스트 확장

```json
{
  "apartments": {
    "1-101": { "name":"header-react", "url":"/wasm-or-js/header-react.js" },
    "2-201": { "name":"page-svelte",  "url":"/wasm-or-js/page-svelte.js"  },
    "2-202": { "name":"page-vue",     "url":"/wasm-or-js/page-vue.js"     },
    "3-301": { "name":"footer-react", "url":"/wasm-or-js/footer-react.js" }
  }
}
```

* 키 `"동-호수"` 로 매핑해서, 주소만 있으면 바로 어떤 모듈을 로드할지 결정

---

## 3. 호스트 앱 라우터 예시 (커스텀)

```js
import manifest from '/module-manifest.json';

async function loadByAddress(dong, hosu, containerEl) {
  const key = `${dong}-${hosu}`;
  const entry = manifest.apartments[key];
  if (!entry) throw new Error('없는 주소입니다: ' + key);

  // JS ESM 번들 혹은 Wasm 모듈 로드
  const mod = await import(/* @vite-ignore */ entry.url);
  // mount 인터페이스 공통화
  if (mod.mount) {
    mod.mount(containerEl);
  } else if (mod.render) {
    mod.render(containerEl);
  }
}

window.addEventListener('popstate', () => {
  const [, dong, , hosu] = location.pathname.split('/');
  loadByAddress(dong, hosu, document.getElementById('root'));
});
```

* `mount/unmount` 인터페이스만 표준화하면, 프레임워크 불문

---

## 4. 동·호 분리의 장점

1. **명확한 네임스페이스**:

   * URL만 보고 어떤 모듈이, 어떤 버전인지 바로 파악 가능
2. **유연한 믹스매치**:

   * 같은 페이지(동) 안에서도 여러 버전(호수)을 A/B 테스트·롤백 용이
3. **운영·모니터링**:

   * 에러 발생 시 “동‑호수” 태그로 빠르게 위치 추적
4. **권한 분리**:

   * 특정 동(예: 1동 헤더)은 디자인팀, 2동 메인페이지는 개발팀 등 역할 분리

---

## 5. 고려할 점

* **라우팅 복잡도**: URL 패턴이 많아지면 라우터 설정·가드 로직이 장황해질 수 있으므로,

  * `dong`별 기본 호수 그룹만 허용하거나
  * 매니페스트 기반 동적 라우팅 테이블을 자동 생성
* **성능**:

  * 각 동을 로드할 때마다 별도 네트워크 요청이 필요하므로, 핵심 UI(헤더·푸터)는 미리 프리로드
* **UX**:

  * URL 디자인은 직관적으로, `/apt/1-101` 같은 축약형도 고려

---

이렇게 “아파트 동·호수”처럼 **2차원 주소 체계**를 도입하면,

* 프레임워크·버전이 뒤섞인 복잡한 모노레포에서도
* **한눈에 구조가 파악**되고
* **운영·디버그·A/B 테스트**가 쉬워집니다.
맞습니다. Svelte, React, Vue 같은 서로 다른 프레임워크로 작성된 “마이크로 프런트엔드”를 하나의 모노레포에서 운영하려면, **앱 셸(App Shell)** 수준에서 라우팅·로딩을 관리해 주는 구조가 필요합니다. 대표적인 접근법들을 정리해 드릴게요.

---

## 1. 전체 구조 예시

```
/apps
  /app-shell           ← 공통 라우터·레イ아웃 셸
/packages
  /header-react        ← React 헤더 컴포넌트
  /page-svelte         ← Svelte 기반 메인 페이지
  /page-vue            ← Vue 기반 서브 페이지
```

* **app-shell**: 브라우저에 한 번만 로드되며, URL 경로에 따라 각 마이크로 앱을 동적 로드·마운트
* **header-react**, **page-svelte**, **page-vue**: 각자 독립적으로 빌드된 번들 또는 Wasm·ESM 모듈

---

## 2. Single‑SPA를 이용한 라우팅

[`single‑spa`](https://single-spa.js.org/) 는 서로 다른 프레임워크 앱을 하나의 브라우저 런타임에서 조합할 때 많이 쓰입니다.

### 2.1 app-shell (`apps/app-shell/src/index.js`)

```js
import { registerApplication, start } from 'single-spa';

// 항상 표시되는 Header
registerApplication({
  name: '@gaesup/header-react',
  app: () => System.import('@gaesup/header-react'),
  activeWhen: () => true,
});

// 메인 페이지 (Svelte)
registerApplication({
  name: 'page-svelte',
  app: () => System.import('page-svelte'),
  activeWhen: location => location.pathname === '/',
});

// 서브 페이지 (Vue)
registerApplication({
  name: 'page-vue',
  app: () => System.import('page-vue'),
  activeWhen: location => location.pathname.startsWith('/vue'),
});

start();
```

* **SystemJS** 또는 **Import Maps** 를 이용해 각 패키지를 URL → ESM 매핑
* `activeWhen` 으로 라우팅 분기, true/false 반환에 따라 마운트/언마운트

### 2.2 Import Maps 설정 (예시)

```html
<script type="systemjs-importmap">
{
  "imports": {
    "@gaesup/header-react": "/packages/header-react/dist/header.js",
    "page-svelte":            "/packages/page-svelte/dist/main.js",
    "page-vue":               "/packages/page-vue/dist/main.js"
  }
}
</script>
<script src="https://cdn.jsdelivr.net/npm/systemjs/dist/system.min.js"></script>
<script src="/apps/app-shell/dist/single-spa-config.js"></script>
```

---

## 3. Webpack Module Federation 활용

Webpack 5의 **Module Federation** 으로도 프레임워크 간 공유 및 라우팅이 가능합니다.

```js
// apps/app-shell/webpack.config.js
plugins: [
  new ModuleFederationPlugin({
    name: 'app_shell',
    remotes: {
      header_react: 'header_react@https://cdn/.../remoteEntry.js',
      page_svelte:  'page_svelte@https://cdn/.../remoteEntry.js',
      page_vue:     'page_vue@https://cdn/.../remoteEntry.js',
    },
    shared: [...],
  }),
],
```

```js
// app-shell Router 설정 (React 예시)
import Header from 'header_react/Header';
import SvelteApp from 'page_svelte/App';
import VueApp from 'page_vue/App';

<BrowserRouter>
  <Header />
  <Switch>
    <Route exact path="/" component={SvelteApp} />
    <Route path="/vue"   component={VueApp} />
  </Switch>
</BrowserRouter>
```

* 각 패키지는 `ModuleFederationPlugin` 의 `exposes` 로 자신의 진입점을 노출
* app-shell 에서는 `remotes` 로 동적 로드

---

## 4. 커스텀 라우터 & 동적 import

Single‑SPA나 MF가 부담스럽다면, 아주 심플하게 아래처럼 **커스텀 라우터**를 만들어도 됩니다.

```js
// apps/app-shell/src/router.js
const routes = [
  { path: '/',   loader: () => import('page-svelte') },
  { path: '/vue',loader: () => import('page-vue')   },
];

export async function handleRouteChange() {
  const { pathname } = window.location;
  const route = routes.find(r => r.path === pathname);
  if (!route) return;
  const module = await route.loader();
  // 모듈이 React/Svelte/Vue 앱인지에 따라 마운트 로직 분기
  module.mount && module.mount(document.getElementById('root'));
}

window.addEventListener('popstate', handleRouteChange);
handleRouteChange();
```

* `import()` 는 번들링 시 각 프레임워크별 청크로 분리됨
* 각 모듈에 `mount(el)` / `unmount(el)` 인터페이스만 통일하면 됨

---

## 5. 요약 & 고려사항

| 방식              | 장점                              | 단점                                |
| ----------------- | --------------------------------- | ----------------------------------- |
| Single‑SPA        | 프레임워크 무관·성숙된 에코시스템 | Import Maps 설정 복잡               |
| Module Federation | Webpack 환경 그대로 활용 가능     | 설정 난이도↑, 번들 사이즈 관리 필요 |
| 커스텀 라우터     | 가장 가볍고 단순                  | 수작업 마운트/언마운트 로직 필요    |

* **공통 UI(Header/Footer)** 는 모든 경로에서 `activeWhen: () => true` 로 항상 마운트
* **각 앱** 은 `mount`/`unmount` 표준 인터페이스를 구현
* **상태관리**(`state-manager.wasm` 등) 모듈은 app-shell 에서 초기화 → 자식 앱에 전달

---

이렇게 셸 앱만 “라우터” 역할을 맡기고, Svelte·React·Vue 모듈들은 **자기 프레임워크로만 집중**할 수 있도록 분리하면, 모노레포에서도 깔끔하게 다중 프레임워크를 운영할 수 있습니다.
모듈별로 독립 배포하다 보면, 같은 페이지에 수십 개의 컴포넌트가 올라갈 때 **스타일 일관성**이 깨지는 게 가장 큰 고민이죠. 이를 막기 위한 핵심 전략은 “전역에서 정의한 디자인 토큰(Design Tokens)과 테마(Theme)를 각 모듈이 공유”하도록 만드는 것입니다. 구체적으로 아래와 같이 접근해 보세요.

---

## 1. 디자인 토큰 & CSS Custom Properties

1. **전역 디자인 토큰 정의**

   * `:root` 에서 색상·폰트·간격·애니메이션 속성 등을 모두 CSS 변수로 선언

   ```css
   /* public/styles/design-tokens.css */
   :root {
     /* 색상 팔레트 */
     --color-primary: #0052cc;
     --color-secondary: #172b4d;
     --color-accent: #ff5630;
     /* 타이포그래피 */
     --font-family-base: 'Noto Sans KR', sans-serif;
     --font-size-base: 16px;
     --font-size-lg: 1.125rem;
     /* 간격(Spacing Scale) */
     --space-1: 4px;
     --space-2: 8px;
     --space-3: 16px;
     --space-4: 24px;
     /* 애니메이션 타이밍 */
     --ease-default: cubic‑bezier(0.4,0,0.2,1);
   }
   ```

2. **호스트 앱에서 전역 로드**

   ```html
   <!-- index.html 맨 위에 삽입 -->
   <link rel="stylesheet" href="/styles/design-tokens.css">
   ```

3. **모듈 컴포넌트는 변수 참조만**

   ```css
   /* header.module.css */
   .header {
     background-color: var(--color-primary);
     color: white;
     padding: var(--space-3);
     font-family: var(--font-family-base);
   }
   ```

> 이렇게 하면 모듈마다 개별 CSS 번들에 중복 정의를 제거하고, 테마 변경(예: 다크 모드)도 `:root` 값만 바꾸면 즉시 전체에 반영됩니다.

---

## 2. CSS Modules / Shadow DOM 혼합

* **CSS Modules** 로 클래스명 충돌은 방지하면서, 변수는 전역으로 사용
* **Web Component (Shadow DOM)** 로 캡슐화된 컴포넌트에서도 CSS 커스텀 프로퍼티는 상속받을 수 있습니다

  ```js
  // header.js (LitElement 예시)
  import { LitElement, html, css } from 'lit';
  class AppHeader extends LitElement {
    static styles = css`
      :host {
        display: block;
        background: var(--color-primary);
        color: #fff;
        padding: var(--space-3);
      }
      h1 { font-size: var(--font-size-lg); }
    `;
    render() {
      return html`<h1>GAESUP</h1>`;
    }
  }
  customElements.define('app-header', AppHeader);
  ```

---

## 3. 테마 토글 & 런타임 지원

1. **다크·라이트 모드 변수**

   ```css
   body.light {
     --color-primary: #0052cc;
     --color-secondary: #172b4d;
     --background: #fff;
   }
   body.dark {
     --color-primary: #4c9aff;
     --color-secondary: #091e42;
     --background: #121212;
   }
   ```

2. **JS 훅에서 토글**

   ```js
   // theme.js
   export function toggleTheme() {
     const body = document.body;
     body.classList.toggle('dark');
     body.classList.toggle('light');
   }
   ```

---

## 4. 디자인 시스템 라이브러리 & 도구

* **Tailwind CSS + 디자인 토큰 추출**

  * Tailwind 설정 파일(`tailwind.config.js`)에 위 변수 스케일을 매핑
  * 유틸리티 클래스 기반으로 일관된 스타일 적용
* **CSS-in-JS (Stitches / Emotion)**

  * 디자인 토큰을 JS 객체로 관리하며, 각 모듈은 `styled(...)` 호출만으로 토큰을 참조
* **Style Lint + Prettier**

  * `stylelint-config-tokens` 등 플러그인으로, 허용된 변수 외 다른 색·크기 사용 시 CI에서 에러

---

## 5. 빌드 & 배포 워크플로우

1. **디자인 토큰 버전 관리**

   * 디자인 토큰 파일은 별도 패키지(`@gaesup-store/design-tokens`)로 관리 → 워크스페이스 공유
2. **모듈 컴파일**

   * 각 모듈은 빌드시 design-tokens 패키지를 의존성으로 가져감
3. **호스트 로드 시점 보장**

   * 토큰 CSS가 반드시 모듈 CSS보다 먼저 로드되도록 `<link rel="preload">` 또는 CSS 인젝션 전략 사용

---

## 6. 요약

* **전역 디자인 토큰(CSS 변수)**: 색상·타이포·간격·애니메이션 기준을 한 곳에 정의
* **모듈은 변수 참조만**: 복제·충돌 없이 일관성 보장
* **모듈 스코핑(CSS Modules/Shadow DOM)**: 클래스 충돌 방지 & 캡슐화
* **테마·버전 관리**: 토큰 패키지 → 신속한 테마 변경·디자인 업데이트
* **툴체인 지원**: Tailwind, CSS-in-JS, Stylelint 등으로 자동 검증

이렇게 “한 페이지에 수십 개 모듈”이 올라도, **모두 같은 디자인 토큰** 위에서 렌더되니 스타일이 절대 뒤죽박죽되지 않습니다.
