# Docker Compose Frontend MSA

This compose setup treats each frontend container slot as a small deployable
service, similar to an MSA topology.

The goal is not to run Docker inside the browser. The goal is to make local and
CI environments look like production:

1. A host shell reads a release plan.
2. Each slot exposes its own manifest endpoint.
3. The host validates ABI, dependency, store, deployment, permission, and import contracts.
4. Only valid frontend containers attach to shared Gaesup state.

## Services

`docker/docker-compose.wasm.yml` defines:

- `slot-registry`: serves `examples/monorepo-containers/release-plan.json` and all manifests.
- `shell-wasm-state`: serves the shell slot manifest.
- `header-wasm-state`: serves the header slot manifest.
- `body-wasm-state`: serves the body slot manifest.
- `sidebar-wasm-state`: serves the sidebar slot manifest.
- `contract-validator`: validates the current release plan and manifests.
- `host-shell`: starts the multi-framework host app with manifest URLs in env vars.

Each slot service is labeled with `gaesup.slot`, `gaesup.runtime`, and
`gaesup.release` so orchestration tools can discover or filter them later.

## Commands

Start the local MSA-style frontend topology:

```bash
docker compose -f docker/docker-compose.wasm.yml up slot-registry shell-wasm-state header-wasm-state body-wasm-state sidebar-wasm-state host-shell
```

Run only contract validation:

```bash
docker compose -f docker/docker-compose.wasm.yml --profile validate run --rm contract-validator
```

Open the host shell:

```text
http://localhost:3000
```

Inspect slot manifests:

```text
http://localhost:5000/release-plan.json
http://localhost:5101/manifest.json
http://localhost:5102/manifest.json
http://localhost:5103/manifest.json
http://localhost:5104/manifest.json
```

## Production Shape

The same shape maps cleanly to deployment:

- One artifact per frontend slot.
- One manifest per artifact.
- A registry pointer table for active slot versions.
- Per-slot rollout and rollback.
- Host-side validation before mount.

The next production step is to replace the local nginx slot services with real
artifact servers or registry records that include the WASM/module URL and
artifact hash.
