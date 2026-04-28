# 성능 최적화

## 현재 병목

core dispatch는 빠릅니다. 체감 속도는 대부분 framework 렌더링과 DOM 반영에서 결정됩니다.

## 권장 사항

### 공유 상태를 작게 유지

여러 프레임워크가 함께 봐야 하는 값만 Gaesup store에 둡니다.

### path 구독 사용

컴포넌트가 store 일부만 필요하면 path를 좁힙니다.

```typescript
GaesupCore.subscribe('orders', 'items', callbackId);
```

### batch 사용

관련 업데이트를 묶습니다.

```typescript
const batch = GaesupCore.createBatchUpdate('orders');
batch.addUpdate('MERGE', { status: 'ready' });
batch.addUpdate('MERGE', { count: 1 });
await batch.execute();
```

### 데모 DOM 단순화

중복 id와 숨은 placeholder를 만들지 않습니다. framework mount point는 비어 있어야 합니다.

### 따로 측정

다음 값을 분리해서 봅니다.

- core dispatch 시간
- store 값 변경 시간
- DOM 전체 반영 시간
- browser heap 사용량
