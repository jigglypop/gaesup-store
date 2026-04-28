# Manifest Service

The manifest is the contract between a WASM package and the host.

## Manifest Shape

```typescript
interface ContainerPackageManifest {
  manifestVersion: '1.0';
  name: string;
  version: string;
  runtime?: WASMRuntimeType;
  wasm?: {
    entrypoint?: string;
    sha256?: string;
    size?: number;
  };
  gaesup?: {
    abiVersion: string;
    minHostVersion?: string;
  };
  dependencies?: Array<{ name: string; version: string; optional?: boolean }>;
  stores?: StoreDependencyContract[];
  permissions?: ContainerPermissionContract;
  allowedImports?: string[];
}
```

## Builder Directives

The container builder can emit these fields from Containerfile-style directives:

```dockerfile
ABI 1.0
DEPENDENCY lodash ^4.17.0
STORE app counter-state ^1.0.0 reject
IMPORT env.memory
```

## Validation

`CompatibilityGuard` checks the manifest against host compatibility config.

Important outcomes:

- `reject`: stop the container when the store schema is incompatible.
- `isolate`: reserved for a future runtime-enforced isolation mode.
- `readonly`: reserved for a future runtime-enforced read-only store mode.
- `migrate`: reserved for schema migration flows.

At present, modes that require runtime enforcement are rejected unless the runtime implements them.
