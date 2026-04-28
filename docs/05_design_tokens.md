# Design Tokens

The demo uses a restrained operational UI style so performance and state propagation are easy to inspect.

## Base Tokens

```css
:root {
  --surface-0: #101820;
  --surface-1: #111b24;
  --surface-2: #14202a;
  --text-0: #e8eef2;
  --text-1: #a9bbc7;
  --border: rgba(255, 255, 255, 0.1);
}
```

Framework accent colors:

```css
--react: #61dafb;
--vue: #42d392;
--svelte: #ff8a3d;
--angular: #dd0031;
```

## UI Guidance

- Prefer dense, readable panels over decorative marketing layout.
- Keep cards shallow and purposeful.
- Avoid duplicate DOM ids in demos; measurements and event handlers become ambiguous.
- Make shared state visible in multiple places so drift is obvious.
