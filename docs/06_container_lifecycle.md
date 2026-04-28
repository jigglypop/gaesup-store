# Container Lifecycle

## Lifecycle Steps

1. Host calls `ContainerManager.run(name, config)`.
2. Manager resolves the manifest from `config.manifest` or registry.
3. `CompatibilityGuard` validates manifest compatibility.
4. Manager applies manifest defaults, including runtime, imports, and permissions.
5. Runtime compiles or instantiates the WASM module.
6. `ContainerInstance` is registered and can receive calls.
7. Manager tracks metrics and cleanup.

## Cleanup

Call:

```typescript
await manager.cleanup();
```

or stop a container instance:

```typescript
await container.stop();
```

## Error Types

Important errors:

- `ContainerCompatibilityError`
- `ContainerStartupError`
- `ContainerMemoryError`
- `ContainerTimeoutError`
- `ContainerSecurityError`

Compatibility errors should be treated as package contract failures, not transient runtime failures.
