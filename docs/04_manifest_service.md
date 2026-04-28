# Manifest 서비스

manifest는 컨테이너와 host 사이의 실행 계약입니다.

## 주요 필드

- `manifestVersion`
- `name`
- `version`
- `gaesup.abiVersion`
- `dependencies`
- `stores`
- `permissions`
- `allowedImports`

## 의존성 source

```typescript
{ name: 'date-fns', version: '^2.29.0', source: 'host' }
{ name: 'chart.js', version: '^3.9.0', source: 'bundled' }
```

- `host`: host가 제공하는 dependency를 사용합니다. 버전이 맞아야 합니다.
- `bundled`: 컨테이너 내부에 패키징된 dependency를 사용합니다. host 버전과 충돌하지 않습니다.

## Store 정책

```typescript
{
  storeId: 'orders',
  schemaId: 'orders-state',
  schemaVersion: '^1.2.0',
  conflictPolicy: 'reject'
}
```

정책:

- `reject`: 충돌 시 실행 차단
- `isolate`: 공유 store 대신 격리 store 사용
- `readonly`: 읽기 전용 접근
- `migrate`: migration 흐름

현재 런타임 enforcement가 없는 정책은 실제 실행 단계에서 보수적으로 막아야 합니다.
