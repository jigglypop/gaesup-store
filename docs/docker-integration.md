# Docker와 WASM 패키징

Gaesup-State는 브라우저에서 Docker 컨테이너를 직접 실행하지 않습니다. 대신 Docker 컨테이너가 가진 좋은 아이디어를 WASM 패키징에 가져옵니다.

- 패키지는 manifest를 가집니다.
- 패키지는 필요한 의존성을 선언합니다.
- 패키지는 권한을 선언합니다.
- 패키지는 접근하려는 store schema를 선언합니다.
- host는 실행 전에 manifest를 검증합니다.

## 컨테이너처럼 실행한다는 뜻

여기서 컨테이너처럼 실행한다는 말은 다음을 의미합니다.

- 패키지별 의존성 경계를 명확히 둔다.
- 패키지가 자기 의존성을 함께 들고 올 수 있다.
- host 의존성을 쓰는 경우에는 host 버전과 맞는지 검증한다.
- 공유 store에 붙기 전에 store schema를 확인한다.
- schema가 맞지 않으면 공유 store를 오염시키지 않는다.

## Bundled dependency

컨테이너가 의존성을 내부에 패키징한 경우:

```typescript
dependencies: [
  { name: 'chart.js', version: '^3.9.0', source: 'bundled' }
]
```

host가 `chart.js@4.4.3`을 쓰고 있어도 이 컨테이너는 자기 내부의 `chart.js@3`으로 실행될 수 있습니다. host dependency graph를 바꾸지 않기 때문에 충돌로 보지 않습니다.

## Host dependency

컨테이너가 host 의존성을 쓰겠다고 선언한 경우:

```typescript
dependencies: [
  { name: 'chart.js', version: '^3.9.0', source: 'host' }
]
```

host가 `chart.js@4.4.3`만 제공한다면 이 패키지는 차단됩니다. host 의존성을 바꾸면 다른 컨테이너와 앱 코드가 영향을 받을 수 있기 때문입니다.

## Containerfile 예시

```dockerfile
FROM scratch
ABI 1.0
DEPENDENCY chart.js ^3.9.0 bundled
STORE analytics analytics-state ^2.0.0 reject
IMPORT env.memory
```

현재 builder directive는 계속 확장 중입니다. 최종 목표는 이 정보가 `ContainerPackageManifest`로 변환되고, host가 실행 전에 검증하는 흐름입니다.
