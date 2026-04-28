# Security and Isolation

Gaesup-State currently uses manifest validation as the first security boundary.

## Enforced Today

- ABI compatibility checks.
- Package dependency checks.
- Store schema checks.
- Allowed import checks.
- Manifest permission metadata checks.
- Rejection of unsupported conflict policies.

## Not Yet Fully Enforced

The following policies require runtime-level enforcement and are intentionally rejected when enforcement is unavailable:

- Isolated store access.
- Read-only store access.
- Fine-grained path-level write controls.
- System call filtering across non-browser runtimes.

## Recommended Host Policy

Use `reject` as the default conflict policy until stronger runtime enforcement exists:

```typescript
const manager = new ContainerManager({
  compatibility: {
    defaultConflictPolicy: 'reject'
  }
});
```

## Import Policy

Use `allowedImports` to keep WASM imports explicit:

```typescript
allowedImports: ['env.memory']
```
