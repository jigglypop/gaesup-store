# 아키텍처 개요

Gaesup-State는 세 경계를 분리합니다.

## Store 경계

`GaesupCore`는 이름 있는 store를 관리합니다. store는 `storeId`로 식별되고, schema 정보를 가질 수 있으며, 여러 프레임워크 어댑터가 같은 store를 구독할 수 있습니다.

흐름:

```text
dispatch -> store update -> callback notification -> framework render
```

## Container 경계

`ContainerManager`는 WASM 컨테이너를 실행하기 전에 manifest를 확인합니다.

검증 항목:

- Gaesup ABI
- host 의존성
- bundled 의존성
- store schema
- import 목록
- 권한 선언
- 충돌 정책

## Framework 경계

React, Vue, Svelte, Angular 패키지는 같은 store를 각 프레임워크 방식으로 구독합니다. 프레임워크별 local state가 아니라 Gaesup store snapshot을 렌더링해야 상태가 어긋나지 않습니다.

## 핵심 원칙

컨테이너는 실행 전에 계약을 밝혀야 합니다. 의존성과 store schema가 맞는지 확인하지 않은 패키지는 공유 상태에 접근하면 안 됩니다.
