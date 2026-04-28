# 성능 메모

## 최근 측정 결과

멀티 프레임워크 데모를 단순한 네 카운터 구조로 바꾼 뒤 측정한 값입니다.

```text
초기 ready: 약 827ms
네 카운터 전체 반영 p50: 약 32ms
네 카운터 전체 반영 p95: 약 65ms
core dispatch p50: 약 0.13ms
core dispatch p95: 약 0.29ms
```

## 해석

store dispatch 자체는 빠릅니다. 체감 지연은 대부분 다음에서 발생합니다.

- 브라우저 click event 처리
- framework별 render scheduling
- 네 framework root의 DOM 업데이트
- 개발 서버와 sourcemap 비용

즉, 현재 병목은 core state update가 아니라 화면 반영 비용입니다.

## 이전 데모에서 느렸던 이유

이전 화면은 header, sidebar, main, footer, metrics polling, history rendering이 섞여 있었습니다. 또한 같은 id를 가진 초기 HTML과 실제 framework 렌더 결과가 공존해서 클릭 타깃과 측정값이 불안정했습니다.

현재 구조는 다음을 지킵니다.

- framework mount point는 비어 있음
- 각 framework는 하나의 counter card만 렌더링
- interactive id 중복 없음
- 네 카드가 같은 store 값만 표시
- 의존성 격리 예제는 별도 페이지로 분리

## 측정 기준

브라우저에서 다음 조건을 확인했습니다.

```typescript
await page.locator('[data-action="react-inc"]').click();

await page.waitForFunction(() =>
  [...document.querySelectorAll('[data-counter]')]
    .every((node) => node.textContent?.trim() === '1')
);
```

즉, 버튼 클릭 후 네 framework 카드가 모두 같은 값을 표시할 때까지의 시간입니다.

## 최적화 방향

- store에는 여러 framework가 공유해야 하는 값만 둡니다.
- UI local state는 각 framework에 남겨둡니다.
- 큰 객체 전체를 자주 dispatch하지 않습니다.
- 가능한 경우 path 단위 subscription을 사용합니다.
- dependency isolation 검증은 실행 전에 끝냅니다.
