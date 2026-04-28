# Dispatch pipeline

Dispatch pipeline은 같은 store로 들어가는 여러 변경을 한 번에 묶어서 Rust/WASM core로 보내는 API입니다.

일반적으로 아래처럼 여러 `dispatch`를 연속으로 부르면 JS/WASM 경계를 여러 번 넘습니다.

```typescript
await GaesupCore.dispatch('editor', 'UPDATE', {
  path: 'document.title',
  value: 'New title'
});

await GaesupCore.dispatch('editor', 'UPDATE', {
  path: 'selection.active',
  value: true
});

await GaesupCore.dispatch('editor', 'DELETE', {
  path: 'draft.error'
});
```

pipeline을 쓰면 같은 변경을 한 번의 `BATCH`로 보냅니다.

```typescript
const pipe = GaesupCore.pipeline('editor', {
  autoFlush: false
});

pipe.update('document.title', 'New title');
pipe.update('selection.active', true);
pipe.delete('draft.error');

await pipe.flush();
```

## 왜 빠른가

pipeline은 세 가지 비용을 줄입니다.

1. JS/WASM 경계 호출 횟수를 줄입니다.
2. JS 쪽에서 같은 path의 반복 변경을 마지막 값 하나로 줄입니다.
3. Rust core의 `BATCH`는 state를 한 번 clone한 뒤 내부 mutation을 in-place로 적용합니다.

즉, JS에서는 여러 action을 하나의 payload로 묶고, Rust에서는 그 payload를 하나의 state update 흐름으로 처리합니다.

## 기본 API

```typescript
const pipe = GaesupCore.pipeline('store-id');
```

`autoFlush` 기본값은 `true`입니다. 같은 microtask 안에서 쌓인 변경은 자동으로 flush됩니다.

```typescript
const pipe = GaesupCore.pipeline('counter');

pipe.update('count', 1);
pipe.update('count', 2);
```

수동 flush가 필요하면 `autoFlush: false`를 사용합니다.

```typescript
const pipe = GaesupCore.pipeline('counter', {
  autoFlush: false
});

pipe.update('count', 1);
pipe.update('count', 2);

await pipe.flush();
```

## 메서드

### update

특정 path를 갱신합니다.

```typescript
pipe.update('user.name', 'Ada');
```

같은 path를 여러 번 갱신하면 마지막 값만 남습니다.

```typescript
pipe.update('count', 1);
pipe.update('count', 2);

await pipe.flush(); // count = 2
```

### delete

특정 path를 삭제합니다.

```typescript
pipe.delete('draft.error');
```

### merge

root object에 object merge를 적용합니다.

```typescript
pipe.merge({
  dirty: true,
  lastEditedBy: 'local'
});
```

### set

store 전체를 교체합니다.

```typescript
pipe.set({
  count: 0,
  user: { name: 'Ada' }
});
```

`set`은 강한 작업입니다. 같은 pipeline 안에 여러 `set`이 있으면 마지막 `set` 이후의 mutation만 의미가 있습니다.

### dispatch

직접 action type과 payload를 넣습니다.

```typescript
pipe.dispatch('UPDATE', {
  path: 'count',
  value: 1
});
```

일반적인 상태 변경은 `update`, `delete`, `merge`, `set`을 쓰는 편이 읽기 좋습니다.

### flush

쌓인 mutation을 보냅니다.

```typescript
await pipe.flush();
```

쌓인 mutation이 하나뿐이면 단일 dispatch로 보내고, 두 개 이상이면 `BATCH`로 보냅니다.

### clear

아직 flush되지 않은 mutation을 버립니다.

```typescript
pipe.clear();
```

## Auto store와의 관계

`gaesup` auto store는 내부적으로 변경 path를 모으고 flush 때 patch를 보냅니다. 즉, 사용자 입장에서는 이미 pipeline과 비슷한 효과를 받습니다.

```typescript
const state = gaesup('editor', {
  document: { title: 'Draft' },
  selection: { active: false }
});

state.document.title = 'New title';
state.selection.active = true;

await state.$flush();
```

직접 `GaesupCore.dispatch`를 여러 번 부르는 코드, editor command, drag update, API 결과 반영처럼 여러 field를 한 번에 바꾸는 코드에는 explicit pipeline이 더 잘 맞습니다.

## Subscriber 호출

pipeline은 여러 mutation을 하나의 dispatch로 보내므로 store subscriber도 한 번만 깨우는 방향으로 동작합니다.

```typescript
GaesupCore.subscribe('editor', '', (state) => {
  console.log(state);
});

const pipe = GaesupCore.pipeline('editor', { autoFlush: false });

pipe.update('document.title', 'New title');
pipe.update('selection.active', true);

await pipe.flush(); // subscriber는 최종 state 기준으로 호출
```

subscriber가 많은 화면에서는 이 차이가 중요합니다. 변경마다 subscriber를 깨우는 대신, 최종 state를 기준으로 한 번만 반응하게 만들 수 있습니다.

## 언제 쓰면 좋은가

| 상황 | 추천 |
| --- | --- |
| 버튼 클릭 한 번에 여러 field 변경 | pipeline |
| drag 중 position, velocity, selection 동시 변경 | pipeline 또는 render runtime |
| API 응답을 여러 store field에 반영 | pipeline |
| 사용자가 객체를 직접 수정하는 UI 상태 | auto store |
| 매 프레임 transform 갱신 | render runtime |
| 숫자 하나 초고빈도 증가 | counter handle fast path |

## 주의점

pipeline은 같은 store 안에서 순서대로 처리되는 변경을 묶는 도구입니다. 서로 다른 store를 원자적으로 묶는 트랜잭션은 아직 아닙니다.

또한 `autoFlush: true`일 때는 microtask 끝에서 자동 flush됩니다. 특정 시점까지 반드시 기다렸다가 보내야 하는 editor undo/redo, 저장 command, 테스트 코드에서는 `autoFlush: false`가 더 명확합니다.

## Rust core 내부 처리

Rust core의 `BATCH`는 다음 흐름으로 처리합니다.

1. 현재 state를 한 번 clone합니다.
2. batch 안의 mutation을 순서대로 in-place 적용합니다.
3. 최종 state를 store에 저장합니다.
4. subscriber에게 최종 state를 기준으로 알립니다.

이 구조는 이전처럼 batch 내부 update마다 state를 다시 clone하는 방식보다 안정적으로 빠릅니다.
