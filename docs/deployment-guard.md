# Deployment guard

Deployment guard는 WASM 컨테이너를 화면 조각 단위로 따로 배포할 때, 서로 맞지 않는 조각이 한 화면 안에 섞이지 않도록 막는 장치입니다.

예를 들어 쇼핑몰 화면을 `header`, `body`, `sidebar`, `footer` 컨테이너로 나누면 각 컨테이너는 독립적으로 교체될 수 있습니다. 이때 `body`만 새 버전이고 `header`는 예전 계약을 들고 있으면 이벤트 이름, store schema, slot props가 어긋날 수 있습니다. Deployment guard는 실행 전에 이 조합을 검사합니다.

## 핵심 규칙

- host는 현재 화면에 올라온 slot 목록을 `deployment.slots`로 등록합니다.
- 각 컨테이너 manifest는 자신이 들어갈 `slot`과 `releaseId`를 선언합니다.
- 컨테이너가 다른 조각에 의존하면 `deployment.requires`에 필요한 slot 계약을 적습니다.
- `strictRelease`가 켜져 있으면 host와 다른 `releaseId`의 컨테이너는 실행하지 않습니다.
- 같은 release라도 peer slot의 `slotVersion` 또는 `contractVersion`이 맞지 않으면 실행하지 않습니다.

## Host contract

```typescript
const host = {
  abiVersion: '1.0.0',
  deployment: {
    releaseId: 'web-2026-04-28.1',
    strictRelease: true,
    slots: [
      {
        slot: 'header',
        packageName: 'shop-header',
        version: '1.4.0',
        releaseId: 'web-2026-04-28.1',
        slotVersion: '1.4.0',
        contractVersion: '1.1.0'
      },
      {
        slot: 'body',
        packageName: 'shop-body',
        version: '1.8.0',
        releaseId: 'web-2026-04-28.1',
        slotVersion: '1.8.0',
        contractVersion: '1.2.0'
      }
    ]
  }
};
```

`releaseId`는 같은 배포 묶음을 뜻합니다. 보통 CI 빌드 번호, Git SHA, 날짜 기반 release line을 씁니다.

`slotVersion`은 해당 화면 조각의 기능 버전입니다. `contractVersion`은 그 조각이 외부에 노출하는 이벤트, props, store 접근 계약의 버전입니다.

## Container manifest

```typescript
const bodyManifest = {
  manifestVersion: '1.0',
  name: 'shop-body',
  version: '1.8.0',
  gaesup: { abiVersion: '^1.0.0' },
  deployment: {
    slot: 'body',
    releaseId: 'web-2026-04-28.1',
    slotVersion: '1.8.0',
    contractVersion: '1.2.0',
    requires: [
      {
        slot: 'header',
        releaseId: 'web-2026-04-28.1',
        slotVersion: '^1.4.0',
        contractVersion: '^1.1.0'
      }
    ]
  }
};
```

이 manifest는 `body`가 실행되려면 `header`가 같은 release line에 있어야 하고, `header`의 slot 버전은 `1.x` 중 `1.4.0` 이상이어야 하며, header가 제공하는 계약은 `1.1.0` 이상이어야 한다고 선언합니다.

## 검증

```typescript
import { CompatibilityGuard } from 'gaesup-state';

const guard = new CompatibilityGuard(host);
const result = guard.validate(bodyManifest);

if (!result.valid) {
  throw new Error(result.errors[0]?.message || 'Deployment contract mismatch');
}
```

## 막는 상황

### 다른 release 조각

host가 `web-2026-04-28.1`인데 `body`가 `web-2026-04-27.9`로 들어오면 `DEPLOYMENT_RELEASE_MISMATCH`로 차단합니다.

### 필요한 slot 없음

`body`가 `header`를 요구하는데 host에 `header` slot이 없으면 `DEPLOYMENT_SLOT_MISSING`으로 차단합니다.

### peer slot 버전 불일치

`body`가 `header.slotVersion: ^2.0.0`을 요구하는데 host의 header가 `1.4.0`이면 `DEPLOYMENT_SLOT_VERSION_MISMATCH`로 차단합니다.

### peer contract 불일치

`body`가 `header.contractVersion: ^2.0.0`을 요구하는데 host의 header contract가 `1.1.0`이면 `DEPLOYMENT_SLOT_CONTRACT_MISMATCH`로 차단합니다.

## store contract와의 관계

Deployment guard는 화면 조각의 조립 순서를 막는 장치이고, store schema guard는 공유 상태 접근을 막는 장치입니다. 둘 다 필요합니다.

- deployment guard: 헤더, 몸통, 사이드바 같은 화면 조각이 같은 조합으로 실행되는지 확인
- store schema guard: 컨테이너가 공유 store에 붙어도 상태 구조가 깨지지 않는지 확인
- dependency guard: 컨테이너가 host dependency graph를 깨지 않는지 확인

즉, deployment guard를 통과해도 store schema가 맞지 않으면 공유 store 접근은 여전히 차단되거나 격리됩니다.

## 권장 배포 흐름

1. CI에서 각 WASM 컨테이너 manifest에 `releaseId`, `slot`, `slotVersion`, `contractVersion`을 기록합니다.
2. shell 또는 host app은 현재 화면에 올릴 slot 목록을 `HostCompatibilityConfig.deployment.slots`로 만듭니다.
3. 컨테이너를 mount하기 전에 `CompatibilityGuard.validate`를 호출합니다.
4. 실패하면 이전에 검증된 컨테이너 조합을 유지하거나 fallback slot을 렌더링합니다.
5. 성공한 조합만 같은 shared store와 render runtime에 연결합니다.
