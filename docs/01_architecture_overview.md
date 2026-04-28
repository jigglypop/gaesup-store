# 아키텍처 개요

Gaesup-State는 세 계층으로 나뉩니다.

1. Rust/WASM core
2. TypeScript API wrapper
3. framework adapter와 demo application

Rust/WASM core는 실제 상태와 manifest 검증 로직을 들고 있습니다. TypeScript wrapper는 브라우저와 앱 코드에서 쓰기 쉬운 API를 제공합니다. React, Vue, Svelte, Angular 어댑터는 같은 store를 각 프레임워크 방식으로 구독합니다.

## 큰 흐름

```text
application
  -> gaesup-state TypeScript API
  -> Rust WASM core
  -> store / compatibility / container / render modules
```

상태 업데이트는 `GaesupCore.dispatch`를 통해 Rust core로 들어갑니다. Rust core는 store를 갱신하고 구독자에게 알립니다. 프레임워크 어댑터는 이 알림을 받아 각 UI를 다시 그립니다.

## 모듈

| 모듈 | 역할 |
| --- | --- |
| `store.rs` | named store, dispatch, select, subscribe, snapshot, metrics |
| `compatibility.rs` | ABI, dependency, store schema, accelerator 검증 |
| `container.rs` | 컨테이너 lifecycle과 call/metrics |
| `render.rs` | 화면 전환, transform state, matrix buffer |
| `render_math.rs` | matrix 계산 |

`lib.rs`는 export와 초기화만 담당하도록 얇게 유지합니다.

## 설계 기준

- 공유 상태는 하나의 Rust store를 기준으로 합니다.
- 패키지는 manifest로 필요한 실행 조건을 선언합니다.
- host는 실행 전에 계약을 검증합니다.
- store schema가 맞지 않으면 공유 store 접근을 막습니다.
- 렌더링처럼 빈도가 높은 데이터는 JSON보다 typed buffer로 전달합니다.

## 현재 한계

현재 구현은 WASM 패키지를 컨테이너처럼 검증하는 런타임 모델입니다. OS 수준 Docker 격리와 동일하지 않습니다. 강한 보안 격리는 iframe, worker, CSP, import whitelist, native host sandbox 같은 계층을 추가로 얹어야 합니다.
