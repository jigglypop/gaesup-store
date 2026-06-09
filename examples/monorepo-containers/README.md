# Monorepo WASM container example

이 예제는 하나의 GitHub 모노레포 안에서 여러 WASM 컨테이너를 화면 조각처럼 배포하는 흐름을 보여줍니다.

```text
examples/monorepo-containers/
  release-plan.json
  containers/
    shell/manifest.json
    header/manifest.json
    body/manifest.json
    sidebar/manifest.json
```

`release-plan.json`은 host shell이 현재 화면에 올릴 slot 조합입니다. 각 컨테이너 manifest는 자신이 들어갈 slot, release line, 필요한 peer slot contract를 선언합니다.

## 실행

```bash
pnpm --filter @gaesup-example/monorepo-containers run validate
```

루트에서는 같은 검증을 이렇게 실행할 수 있습니다.

```bash
pnpm run example:monorepo
```

예상 결과:

```text
OK      shell
OK      header
OK      body
OK      sidebar
BLOCKED body release drift
        DEPLOYMENT_RELEASE_MISMATCH: ...
BLOCKED body contract drift
        DEPLOYMENT_SLOT_VERSION_MISMATCH: ...
        DEPLOYMENT_SLOT_CONTRACT_MISMATCH: ...
```

## 운영에서 쓰는 방식

1. `main`에 merge되면 CI가 각 package의 manifest를 생성합니다.
2. release branch에서 같은 `releaseId`를 모든 slot manifest에 주입합니다.
3. host shell은 `release-plan.json` 또는 registry 응답으로 현재 slot 조합을 받습니다.
4. mount 전에 `validate_manifest`를 실행합니다.
5. 통과한 컨테이너만 shared store와 render runtime에 연결합니다.

이렇게 하면 `body`만 새로 올라가고 `header`가 예전 계약인 상태를 실행 전에 막을 수 있습니다.
