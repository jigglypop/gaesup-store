# 보안과 격리

Gaesup의 보안 모델은 “컨테이너가 로드되었으니 신뢰한다”가 아니라 “계약을 검증한 뒤 제한된 capability만 허용한다”를 기본으로 한다.

브라우저에서 Docker 수준의 격리를 제공한다고 주장하지 않는다. 대신 WASM import allowlist, artifact 검증, Worker/iframe isolation, store schema contract, permission policy를 조합해 프론트엔드 컨테이너의 실행 범위를 좁힌다.

## 기본 원칙

- 기본값은 fail-closed다.
- manifest 검증 전에는 컨테이너를 instantiate하거나 shared store에 attach하지 않는다.
- `allowedImports`에 없는 WASM import는 차단한다.
- `permissions`에 없는 network, storage, effect capability는 거부한다.
- side effect는 WASM 내부에서 직접 실행하지 않고 JS host가 permission check 후 실행한다.
- denied capability는 audit event와 stable error code로 남긴다.

## Artifact 검증

컨테이너 artifact는 실행 전에 다음을 검증한다.

- `sha256` hash
- 선택적 public-key signature
- ABI compatibility
- deployment slot contract

`sha256`이 없으면 기본적으로 로드하지 않는다. 개발 중에만 `allowUnsignedArtifacts`를 사용할 수 있다.

## WASM import 정책

WASM import는 `allowedImports`로 명시한다.

```json
{
  "allowedImports": [
    "gaesup:time/now",
    "gaesup:storage/get_i32"
  ]
}
```

허용 형식은 다음을 지원한다.

- `module.name`
- `module/name`
- `module:name`
- `module`
- `name`

허용된 import라도 capability implementation이 없으면 `CAPABILITY_NOT_IMPLEMENTED`로 실패한다.

## Permission 정책

### Network

네트워크는 기본적으로 비활성화된다.

```json
{
  "permissions": {
    "network": {
      "enabled": true,
      "allow": ["https://api.example.com"]
    }
  }
}
```

런타임은 network permission이 없으면 `NETWORK_PERMISSION_DENIED`로 거부해야 한다. host fetch capability를 제공할 때는 allowlist와 URL match를 반드시 적용한다.

### Storage

스토리지는 기본적으로 `none`이다.

```json
{
  "permissions": {
    "storage": {
      "mode": "scoped",
      "namespace": "shop-header"
    }
  }
}
```

권장값은 `scoped`다. `host` storage는 host application이 별도 정책과 audit log를 제공할 때만 사용한다.

### Effects

machine effect는 descriptor로 반환되고 JS host가 실행한다.

```json
{
  "permissions": {
    "effects": ["effects:requestPayment"]
  }
}
```

허용되지 않은 effect는 `EFFECT_PERMISSION_DENIED`로 기록한다.

## Worker와 iframe isolation

- WASM state/effect container는 Worker isolation을 우선 사용한다.
- UI container는 iframe isolation을 사용할 수 있다.
- iframe은 기본적으로 `allow-scripts`만 허용한다.
- DOM 권한이 필요한 경우에도 `allow-same-origin`은 신중하게 사용한다.

## CSP 권장값

host application은 배포 환경에서 CSP를 명시해야 한다.

```http
Content-Security-Policy:
  default-src 'self';
  script-src 'self' 'wasm-unsafe-eval';
  worker-src 'self' blob:;
  child-src 'self';
  frame-src 'self' https://trusted-container.example.com;
  connect-src 'self' https://api.example.com;
  object-src 'none';
  base-uri 'none';
```

주의:

- `blob:` worker를 쓰지 않는 배포에서는 `worker-src blob:`을 제거한다.
- iframe 컨테이너 CDN은 `frame-src`에 명시한다.
- container network permission allowlist와 `connect-src`는 같은 방향으로 유지한다.
- 개발 편의를 위해 `unsafe-inline`을 추가하지 않는다.

## Store schema 방어

공유 store는 schema contract boundary다.

- schema가 맞으면 attach한다.
- 맞지 않으면 기본적으로 `reject`한다.
- `isolate`는 격리 store를 사용한다.
- `migrate`는 attach 전에 migration을 완료해야 한다. 런타임은 migration 완료 표시 전 공유 store read/write를 `STORE_MIGRATION_REQUIRED`로 거부한다. `GaesupCore.migrateStore()` migration 함수가 실패하면 `STORE_MIGRATION_FAILED`를 남기고 store는 계속 차단 상태로 유지된다.
- `readonly`는 read만 허용하고 write를 거부한다.
- `shadow`는 copied state에서 preview/testing 용도로 실행한다.
- `dual-write`는 old/new schema에 write하는 기간을 명시적으로 추적한다.

## Operator audit event

운영자는 다음 event를 확인할 수 있어야 한다.

- `manifest:validated`
- `container:loaded`
- `store:attached`
- `store:isolated`
- `machine:transitioned`
- `effect:requested`
- `effect:denied`
- `container:stopped`
- `runtime:error`

audit event에는 container id, store id, machine id, event name, error code, duration을 가능한 한 포함한다.
