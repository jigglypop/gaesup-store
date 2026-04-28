# 디자인 토큰

데모 UI는 상태 동기화와 의존성 판정을 읽기 쉽게 보여주는 운영형 화면을 목표로 합니다.

## 기본 색

```css
--surface-0: #101820;
--surface-1: #111b24;
--surface-2: #14202a;
--text-0: #e8eef2;
--text-1: #a9bbc7;
--border: rgba(255, 255, 255, 0.1);
```

## 프레임워크 accent

```css
--react: #61dafb;
--vue: #42d392;
--svelte: #ff8a3d;
--angular: #dd0031;
```

## 원칙

- 중복 id를 만들지 않습니다.
- framework mount point는 비워둡니다.
- 같은 상태가 여러 위치에 보이도록 만들어 drift를 바로 확인합니다.
- 카드 안에 카드가 중첩되지 않게 합니다.
