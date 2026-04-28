# Docker and WASM Packaging

Gaesup-State does not run Docker containers in the browser. It borrows the useful parts of container packaging:

- A package has a manifest.
- A package declares dependencies.
- A package declares permissions.
- A package declares the state schemas it expects.
- The host validates the package before running it.

## Containerfile-Style Metadata

The container builder supports directives similar to Dockerfile metadata:

```dockerfile
FROM scratch
ABI 1.0
DEPENDENCY lodash ^4.17.0
STORE app counter-state ^1.0.0 reject
IMPORT env.memory
```

These fields become a `ContainerPackageManifest`.

## Why Not Just Use Docker

Docker is useful for server-side deployment, but browser frontends need:

- A manifest that can be fetched and checked by JavaScript.
- WASM runtime imports that can be inspected.
- Store schema compatibility before shared UI state is touched.
- Smaller package boundaries than a full OS container.

## Server-Side WASM

For server environments, a WASM package can still be deployed with runtimes such as Wasmtime, WasmEdge, or Wasmer. The same manifest fields should be used so frontend and server hosts validate the same contract.

## Current Runtime Support

The repository includes runtime adapters for browser, Node.js, Wasmtime, WasmEdge, and Wasmer surfaces. Browser and fallback development paths are the most actively exercised in this workspace.
