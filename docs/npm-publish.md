# npm 배포 준비

이 문서는 Gaesup-State를 npm에 배포하기 전에 확인해야 하는 항목을 정리합니다.

## 배포 대상

1차 배포 대상은 다음 두 패키지입니다.

| 패키지 | 역할 |
| --- | --- |
| `gaesup-state-core-rust` | wasm-pack으로 생성한 Rust/WASM runtime |
| `gaesup-state` | 사용자가 import하는 TypeScript API |

framework adapter는 core 배포가 안정화된 뒤 별도 배포하는 편이 안전합니다.

| 패키지 | 상태 |
| --- | --- |
| `@gaesup-state/adapter` | package metadata 정리 완료, API 안정화 필요 |
| `@gaesup-state/react` | package metadata 정리 완료, hook API 검증 필요 |
| `@gaesup-state/vue` | package metadata 정리 완료, build 검증 필요 |
| `@gaesup-state/svelte` | package metadata 정리 완료, build 검증 필요 |
| `@gaesup-state/angular` | package metadata 정리 완료, build 검증 필요 |

## 현재 배포 버전

현재 npm 배포 준비 버전은 `0.0.1`입니다.

아직 API가 빠르게 바뀌고 있으므로 `1.0.0`이 아니라 `0.x`로 배포합니다.

## 배포 전 필수 확인

```bash
pnpm install
pnpm --filter gaesup-state-core-rust run build
pnpm --filter gaesup-state run test
pnpm --filter gaesup-state run type-check
pnpm --filter gaesup-state run build
```

core와 core-rust의 기본 배포 검사는 한 번에 실행할 수 있습니다.

```bash
pnpm run npm:check
```

tarball을 만든 뒤 새 프로젝트에 실제 설치되는지까지 보려면 smoke test를 실행합니다.

```bash
pnpm run npm:smoke
```

이 명령은 `.codex-run/npm-pack`에 `core-rust`, `core` tarball을 만들고, `.codex-run/npm-smoke`에 새 npm 프로젝트를 만든 뒤 두 tarball을 설치합니다. 마지막으로 다음 import가 가능한지 확인합니다.

- `gaesup-state`
- `gaesup-state-core-rust/web`
- `gaesup-state-core-rust/node`

## Rust/WASM 빌드 요구사항

`core-rust` 빌드에는 `wasm-pack`이 필요합니다.

```bash
rustup target add wasm32-unknown-unknown
cargo install wasm-pack
```

`wasm-pack`이 생성한 `pkg`, `pkg-web`, `pkg-node` 안에는 보통 `*`만 들어 있는 `.gitignore`가 생깁니다. 이 상태로는 npm pack에서 WASM 파일이 빠질 수 있으므로, 빌드 후 `prepare:npm-files`가 각 폴더에 `.npmignore`를 생성합니다.

```bash
pnpm --filter gaesup-state-core-rust run prepare:npm-files
```

## 패키지 dry run

배포 전에 반드시 `npm pack --dry-run`으로 포함 파일을 확인합니다.

```bash
pnpm --filter gaesup-state-core-rust run pack:dry
pnpm --filter gaesup-state run pack:dry
```

확인할 파일:

### gaesup-state-core-rust

- `pkg/gaesup_state_core.js`
- `pkg/gaesup_state_core_bg.wasm`
- `pkg/gaesup_state_core.d.ts`
- `pkg-web/gaesup_state_core.js`
- `pkg-web/gaesup_state_core_bg.wasm`
- `pkg-web/gaesup_state_core.d.ts`
- `pkg-node/gaesup_state_core.js`
- `pkg-node/gaesup_state_core_bg.wasm`
- `pkg-node/gaesup_state_core.d.ts`
- `README.md`
- `LICENSE`
- `package.json`

### gaesup-state

- `dist/index.js`
- `dist/index.d.ts`
- `README.md`
- `LICENSE`
- `package.json`

`src`, test file, local logs, benchmark output은 npm package에 들어가지 않아야 합니다.

## publish 순서

`gaesup-state`가 `gaesup-state-core-rust`에 의존하므로 rust package를 먼저 배포합니다.

```bash
cd packages/core-rust
npm publish --access public
```

그 다음 core를 배포합니다.

```bash
cd ../core
npm publish --access public
```

## 설치 테스트

배포 후 새 폴더에서 설치 테스트를 합니다.

```bash
mkdir gaesup-npm-smoke
cd gaesup-npm-smoke
npm init -y
npm install gaesup-state gaesup-state-core-rust typescript vite
```

간단한 Vite 앱에서 다음 import가 되는지 확인합니다.

```typescript
import { gaesup, resource, GaesupCore } from 'gaesup-state';

const state = gaesup({ count: 0 });

await state.$ready;

state.count += 1;
await state.$flush();

console.log(GaesupCore.select(state.$id, 'count'));
```

## npm 문서에서 강조할 내용

npm README에는 다음 내용을 반드시 포함합니다.

- 설치 명령
- `gaesup` 최소 예제
- `resource/query` 예제
- `GaesupCore.pipeline` 예제
- low-level `GaesupCore` 예제
- WASM bundler 주의사항
- docs 링크

## 주의할 점

- `gaesup-state`는 monorepo 상대경로가 아니라 `gaesup-state-core-rust/web`을 import해야 합니다.
- `gaesup-state-core-rust`는 `pkg`, `pkg-web`, `pkg-node`가 모두 생성된 뒤 publish해야 합니다.
- npm에는 `workspace:*` dependency가 들어가면 안 됩니다.
- scoped package이므로 `publishConfig.access = public` 또는 `npm publish --access public`이 필요합니다.
- framework package는 core 배포 후 별도 smoke test를 거친 뒤 배포합니다.
