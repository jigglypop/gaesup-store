# GitHub monorepo Git flow

이 문서는 Gaesup-State를 GitHub 모노레포로 운영할 때의 브랜치, 커밋, PR, release 흐름입니다.

## 브랜치

```text
main
  운영 배포 가능한 기본 브랜치입니다.

develop
  다음 minor 또는 다음 실험 묶음을 모으는 브랜치입니다.

feature/*
  기능 개발 브랜치입니다.

fix/*
  버그 수정 브랜치입니다.

release/*
  배포 후보를 고정하는 브랜치입니다.

hotfix/*
  운영 장애를 바로 고치는 브랜치입니다.
```

작게 운영하려면 `develop` 없이 `main`, `feature/*`, `release/*`, `hotfix/*`만 써도 됩니다.

## 커밋 규칙

Conventional Commits를 권장합니다.

```text
feat(core): add deployment guard
fix(store): keep nested pointer updates stable
perf(render): reduce dirty matrix buffer allocations
docs(readme): explain monorepo container release flow
test(compat): cover release drift validation
chore(ci): add GitHub Actions package gate
```

scope는 package나 영역 이름을 씁니다.

자주 쓰는 scope:

```text
core
core-rust
compat
store
render
docs
demo
ci
release
```

## PR 규칙

PR에는 최소한 아래 내용을 적습니다.

```markdown
## 변경

- deployment guard에 releaseId 검증 추가
- monorepo container 예제 추가

## 검증

- pnpm --filter gaesup-state run test
- cargo test --manifest-path packages/core-rust/Cargo.toml
- pnpm --filter @gaesup-example/monorepo-containers run validate

## 운영 영향

- releaseId가 다른 컨테이너는 mount 전에 차단됨
- 기존 manifest에 deployment가 없으면 기존 동작 유지
```

## release 흐름

1. `feature/*`를 `main` 또는 `develop`에 merge합니다.
2. Changesets로 변경 내용을 기록합니다.
3. release branch를 만듭니다.
4. CI가 WASM build, test, package dry-run, monorepo manifest validation을 실행합니다.
5. 통과하면 npm publish를 실행합니다.
6. GitHub Release에 release manifest와 changelog를 붙입니다.
7. 운영 host registry에 `releaseId`와 slot manifest를 등록합니다.

명령 예시:

```bash
git checkout main
git pull
git checkout -b release/0.0.2
pnpm changeset version
pnpm install
pnpm run npm:check
pnpm run example:monorepo
git add .
git commit -m "chore(release): publish 0.0.2"
git push origin release/0.0.2
```

## hotfix 흐름

```bash
git checkout main
git pull
git checkout -b hotfix/deployment-contract-check
pnpm --filter gaesup-state run test
pnpm run example:monorepo
git add .
git commit -m "fix(compat): block mismatched deployment contract"
git push origin hotfix/deployment-contract-check
```

hotfix는 release branch를 길게 끌지 않고 빠르게 PR을 올립니다. merge 후 patch version을 배포합니다.

## 모노레포에서 주의할 점

- `packages/core-rust`가 먼저 빌드되어야 `packages/core`가 최신 WASM binding을 사용합니다.
- npm에는 `workspace:*` dependency가 들어가면 안 됩니다.
- 예제 앱은 `workspace:*`를 써도 되지만 publish 대상 package는 실제 버전을 가져야 합니다.
- WASM 산출물은 `pkg`, `pkg-web`, `pkg-node`가 모두 있어야 합니다.
- release manifest에는 같은 `releaseId`를 가진 slot만 묶습니다.
