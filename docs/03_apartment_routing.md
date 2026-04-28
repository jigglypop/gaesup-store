# 라우팅 및 격리 슬롯

이 문서는 향후 여러 컨테이너를 한 host 화면에서 분리해 배치하는 모델을 설명합니다.

## 개념

격리 슬롯은 특정 컨테이너가 실행되는 논리적 영역입니다.

```text
route -> slot -> container manifest -> store schema -> framework view
```

## 현재 상태

현재 저장소는 full router를 제공하지 않습니다. 대신 다음 기반 기능이 구현되어 있습니다.

- store schema registry
- container manifest
- compatibility guard
- framework subscription

## 권장 방식

tenant나 route별로 store id를 분리합니다.

```typescript
const storeId = `tenant:${tenantId}:orders`;
```

컨테이너 manifest의 `stores` 항목도 같은 `storeId`를 바라보게 합니다.
