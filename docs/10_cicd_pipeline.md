# CI/CD Pipeline

Use the following checks for pull requests.

## Install

```bash
corepack enable
corepack prepare pnpm@8.10.0 --activate
pnpm install
```

## Build

```bash
pnpm -r --filter "./packages/**" run build
pnpm --filter @gaesup-state/container-builder run build
```

## Test

```bash
pnpm --filter @gaesup-state/core exec vitest run src/__tests__/core.test.ts
```

## Demo Smoke Test

```bash
pnpm --filter @gaesup-state/multi-framework-demo run dev -- --host 0.0.0.0
```

Then verify:

- `http://localhost:3000/` returns 200.
- All four counters update after any counter button is clicked.
- Browser console has no serious errors.

## Release Artifacts

Each package should publish:

- `dist/index.esm.js` or equivalent ESM output.
- `dist/index.js` or CJS output where configured.
- `dist/index.d.ts`.

Vite builds before declaration emission so `dist` cleanup does not remove declarations.
