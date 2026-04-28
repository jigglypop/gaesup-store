# 중앙 매니저

`ContainerManager`는 WASM 컨테이너 실행을 담당하는 host 측 관리자입니다.

## 역할

- manifest 조회
- compatibility 검증
- runtime config 기본값 적용
- WASM runtime 선택
- container instance 추적
- metrics 수집
- cleanup 처리

## 실행 흐름

```text
run(name, config)
  -> manifest 결정
  -> CompatibilityGuard 검증
  -> manifest 기본값 적용
  -> WASM module load
  -> runtime instantiate
  -> ContainerInstance 등록
```

## Store-aware manager

등록된 store schema를 자동으로 compatibility config에 넣고 싶으면 `createStoreAwareContainerManager`를 사용합니다.

```typescript
const manager = createStoreAwareContainerManager({
  defaultRuntime: 'browser'
});
```

## 실패 정책

매니저는 fail-closed 방식입니다. 실행 전 계약이 맞지 않으면 컨테이너를 시작하지 않습니다.
