# CI/CD 파이프라인

Gaesup-State는 TypeScript 패키지와 Rust/WASM 패키지를 함께 검증해야 합니다.

## 기본 순서

```text
install
  -> rust test
  -> wasm build
  -> TypeScript build
  -> example build
  -> integration test
```

## 설치

```bash
pnpm install
rustup target add wasm32-unknown-unknown
cargo install wasm-pack
```

CI 환경에서는 `wasm-pack`과 Rust toolchain cache를 잡는 것이 좋습니다.

## Rust 확인

```bash
cd packages/core-rust
cargo test
cargo check --target wasm32-unknown-unknown --features wasm
```

native test는 모듈 로직을 빠르게 확인합니다. wasm target check는 browser build에서 깨지는 부분을 잡습니다.

## WASM 빌드

```bash
pnpm run build:wasm
```

출력:

- `packages/core-rust/pkg`
- `packages/core-rust/pkg-web`
- `packages/core-rust/pkg-node`

## TypeScript 빌드

```bash
pnpm --filter gaesup-state run build
pnpm -r --filter "./packages/**" run build
```

## 예제 빌드

```bash
pnpm --filter @gaesup-state/multi-framework-demo run build
```

## 권장 CI 체크

- 문서 인코딩 깨짐 검사
- Rust unit test
- wasm target check
- WASM package build
- TypeScript type check
- demo build
- Playwright smoke test

## 실패 시 우선순위

1. Rust test가 깨지면 core 로직을 먼저 봅니다.
2. wasm build가 깨지면 wasm-bindgen export와 feature를 봅니다.
3. TypeScript build가 깨지면 wrapper 타입을 봅니다.
4. demo만 깨지면 adapter 또는 example wiring을 봅니다.
