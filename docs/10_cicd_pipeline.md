# CI/CD

권장 검증 순서입니다.

## 설치

```bash
corepack enable
corepack prepare pnpm@8.10.0 --activate
pnpm install
```

## 빌드

```bash
pnpm -r --filter "./packages/**" run build
pnpm --filter @gaesup-state/container-builder run build
pnpm --filter @gaesup-state/multi-framework-demo run build
```

## 테스트

```bash
pnpm --filter @gaesup-state/core exec vitest run src/__tests__/core.test.ts
```

## 데모 smoke test

```bash
pnpm --filter @gaesup-state/multi-framework-demo run dev -- --host 0.0.0.0
```

확인할 것:

- 페이지가 200으로 열림
- 공유 카운터 네 개가 같이 업데이트됨
- 의존성 격리 페이지에 공유 실행, 패키징 실행, 격리 실행, 차단이 표시됨
- 브라우저 serious console error가 없음
