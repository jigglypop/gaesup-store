# Gaesup-State Multi-Framework Demo

This demo shows one shared Gaesup store rendered by four framework adapters:

- React
- Vue
- Svelte
- Angular-like class component

Each card has its own `+1`, `-1`, and `Reset` buttons. Pressing any button updates the same store, and all four cards update to the same count.

## Why This Demo Exists

The demo is intentionally simple. It is meant to make state consistency visible:

- One store id: `multi-framework-demo`.
- Four independent framework roots.
- One shared count.
- No duplicate interactive ids.
- No hidden local counter state per framework.

This makes it easier to see whether dependency boundaries, framework adapters, and store subscriptions are behaving correctly.

## Run

From the repository root:

```bash
pnpm --filter @gaesup-state/multi-framework-demo run dev -- --host 0.0.0.0
```

Open:

```text
http://localhost:3000/
```

## What to Check

1. The page loads without browser console errors.
2. All four counters start at the same value.
3. Click the React increment button. React, Vue, Svelte, and Angular should all show the same next value.
4. Repeat from Vue, Svelte, and Angular buttons.
5. The top shared count should match every card.

## Local Measurement

After simplification, a local Playwright smoke test measured:

```text
Initial ready time: about 827ms
All four counters visible after click, p50: about 32ms
All four counters visible after click, p95: about 65ms
```

The core dispatch path is much faster than the visible UI update. Most latency comes from browser scheduling and rendering four framework roots.

## Files

```text
src/main.ts
  Initializes the shared store, mounts all framework roots, and updates shared metrics.

src/stores/sharedStore.ts
  Defines the shared state, dispatch helpers, metrics helpers, and subscriptions.

src/components/react/ReactHeader.tsx
  React counter card.

src/components/vue/VueFooter.vue
  Vue counter card.

src/components/svelte/SvelteMain.svelte
  Svelte counter card.

src/components/angular/AngularSidebar.component.ts
  Angular-like counter card.
```

## Notes

This demo uses the JavaScript fallback path when a real WASM build is not present. That is enough to test the frontend state and subscription behavior. Rebuilding the Rust/WASM package is a separate workflow.
