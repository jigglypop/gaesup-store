# 컨테이너 생명주기

## 단계

1. host가 `ContainerManager.run()`을 호출합니다.
2. manager가 manifest를 결정합니다.
3. `CompatibilityGuard`가 ABI, 의존성, store 계약을 검증합니다.
4. manifest의 runtime, import, permission 기본값을 적용합니다.
5. WASM module을 load합니다.
6. runtime이 instance를 만듭니다.
7. `ContainerInstance`가 등록됩니다.

## 정리

```typescript
await container.stop();
await manager.cleanup();
```

## 주요 오류

- `ContainerCompatibilityError`
- `ContainerStartupError`
- `ContainerMemoryError`
- `ContainerTimeoutError`
- `ContainerSecurityError`

compatibility 오류는 일시적인 실행 실패가 아니라 package 계약 실패로 봐야 합니다.
