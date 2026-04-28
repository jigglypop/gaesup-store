# Gaesup-State 멀티 프레임워크 데모

이 데모는 하나의 Gaesup store를 React, Vue, Svelte, Angular-like 컴포넌트가 동시에 구독하는 모습을 보여줍니다.

## 구성

데모는 두 페이지로 구성됩니다.

### 1. 공유 카운터

네 개의 카드가 있습니다.

- React
- Vue
- Svelte
- Angular-like

각 카드에는 `+1`, `-1`, `Reset` 버튼이 있습니다. 어느 카드의 버튼을 눌러도 같은 `multi-framework-demo` store가 업데이트되고, 네 카드가 모두 같은 count를 표시합니다.

### 2. 의존성 격리 확인

컨테이너 manifest를 실행 전에 검증하는 예제입니다.

표시되는 상태:

- `공유 실행`: host 의존성과 store schema가 모두 맞아 shared store 사용 가능
- `패키징 실행`: 컨테이너가 자기 의존성을 함께 패키징해서 host 버전과 충돌하지 않음
- `격리 실행`: 컨테이너는 실행 가능하지만 host shared store schema와 맞지 않아 격리 store 사용
- `차단`: host 의존성을 쓰겠다고 했지만 버전이 맞지 않아 실행 불가

## 실행

저장소 루트에서 실행합니다.

```bash
pnpm --filter @gaesup-state/multi-framework-demo run dev -- --host 0.0.0.0
```

브라우저에서 엽니다.

```text
http://localhost:3000/
```

## 확인 방법

1. 공유 카운터 페이지에서 React의 `+1`을 누릅니다.
2. 네 카드가 모두 `1`이 되는지 확인합니다.
3. Vue, Svelte, Angular-like 버튼도 각각 눌러봅니다.
4. 의존성 격리 확인 페이지로 이동합니다.
5. `공유 실행`, `패키징 실행`, `격리 실행`, `차단` 네 가지 결과를 확인합니다.

## 주요 파일

```text
src/main.ts
  store 초기화, 페이지 전환, 프레임워크 mount, metric 갱신을 담당합니다.

src/stores/sharedStore.ts
  공유 store와 dispatch helper를 정의합니다.

src/dependencyIsolationDemo.ts
  manifest 의존성 격리 예제를 렌더링합니다.

src/components/react/ReactHeader.tsx
  React 카운터 카드입니다.

src/components/vue/VueFooter.vue
  Vue 카운터 카드입니다.

src/components/svelte/SvelteMain.svelte
  Svelte 카운터 카드입니다.

src/components/angular/AngularSidebar.component.ts
  Angular-like 카운터 카드입니다.
```

## 성능 메모

단순화된 네 카운터 구조에서 로컬 측정 결과는 다음과 같습니다.

```text
초기 ready: 약 827ms
네 카운터 전체 반영 p50: 약 32ms
네 카운터 전체 반영 p95: 약 65ms
```

core dispatch 자체보다 브라우저 이벤트 처리와 네 프레임워크 루트 렌더링 비용이 더 큽니다.
