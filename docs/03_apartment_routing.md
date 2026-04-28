# 라우팅과 격리 영역

이 문서의 기존 이름은 apartment routing이었지만, 현재 구조에서는 “패키지별 격리 영역”으로 이해하는 편이 맞습니다.

Gaesup-State에서 격리 영역은 다음 세 가지를 분리하기 위한 개념입니다.

- 패키지 실행 단위
- store 접근 권한
- dependency source

## 공유 store와 격리 store

패키지가 host store와 같은 schema를 요구하면 공유 store에 붙을 수 있습니다.

```typescript
stores: [
  {
    storeId: 'orders',
    schemaId: 'orders-state',
    schemaVersion: '^1.2.0',
    conflictPolicy: 'reject'
  }
]
```

host가 `orders-state@1.2.0`을 제공하면 공유 접근이 가능합니다.

schema가 맞지 않는데 `conflictPolicy: 'isolate'`라면 패키지는 공유 store 대신 격리 namespace를 받아야 합니다.

```typescript
stores: [
  {
    storeId: 'orders',
    schemaId: 'orders-state',
    schemaVersion: '^2.0.0',
    conflictPolicy: 'isolate'
  }
]
```

이렇게 해야 미래 schema를 기대하는 패키지가 현재 host 상태를 깨지 않습니다.

## 라우팅 기준

실제 앱에서는 다음 기준으로 패키지 실행 영역을 나눌 수 있습니다.

| 기준 | 예시 |
| --- | --- |
| 화면 | `/orders`, `/analytics`, `/checkout` |
| 패키지 | `orders-widget`, `legacy-report` |
| store schema | `orders-state@1`, `orders-state@2` |
| 권한 | network false, storage scoped |
| accelerator | cpu, webgpu, cuda |

## 권장 동작

- schema가 맞으면 공유 store 사용
- dependency가 충돌하지만 bundled이면 실행 허용
- host dependency 충돌이면 차단
- store schema가 다르고 isolate면 격리 store 사용
- store schema가 다르고 reject면 차단

이 원칙을 지키면 패키지가 많아져도 상태가 어긋나는 일을 줄일 수 있습니다.
