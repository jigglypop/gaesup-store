# 보안과 격리

Gaesup-State의 현재 격리 모델은 dependency와 store contract를 중심으로 합니다. OS 수준 Docker 격리와 같은 강한 sandbox를 제공하는 단계는 아닙니다.

## 현재 방어하는 것

- host dependency version mismatch
- bundled dependency와 host dependency 충돌
- store schema mismatch
- ABI version mismatch
- accelerator requirement mismatch
- 허용되지 않은 실행 계약

## dependency 방어

패키지가 host dependency를 요구하면 host 버전과 맞아야 합니다.

```typescript
{ name: 'chart.js', version: '^3.9.0', source: 'host' }
```

host가 `chart.js@4.4.3`만 제공하면 차단합니다.

패키지가 dependency를 bundled로 들고 오면 host dependency graph를 바꾸지 않습니다.

```typescript
{ name: 'chart.js', version: '^3.9.0', source: 'bundled' }
```

## store 방어

store schema가 맞지 않으면 공유 store에 붙이면 안 됩니다.

```typescript
{
  storeId: 'orders',
  schemaId: 'orders-state',
  schemaVersion: '^2.0.0',
  conflictPolicy: 'isolate'
}
```

`isolate`는 실행은 허용하되 공유 store 대신 격리 namespace를 쓰는 정책입니다.

## 아직 필요한 보안 계층

강한 격리를 위해서는 다음이 추가되어야 합니다.

- WASM import whitelist enforcement
- package signature 검증
- capability 기반 host function
- iframe 또는 worker isolation
- CSP 정책
- storage namespace 분리
- network permission enforcement
- native host sandbox

## 원칙

검증이 애매하면 fail closed가 기본입니다. 특히 공유 store 접근은 schema가 맞을 때만 허용해야 합니다.

의존성은 bundled로 격리할 수 있지만, 상태는 잘못 공유하면 앱 전체가 깨질 수 있습니다. 그래서 store contract 검증이 dependency 검증만큼 중요합니다.
