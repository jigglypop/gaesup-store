# Performance Notes

## Latest Local Measurements

Measured on the multi-framework demo after simplifying it to four shared counters.

```text
Initial ready time: about 827ms
Four counters visible after click, p50: about 32ms
Four counters visible after click, p95: about 65ms
Direct core dispatch, p50: about 0.13ms
Direct core dispatch, p95: about 0.29ms
```

## Interpretation

The store dispatch path is not the limiting factor. Most visible latency comes from:

- Browser event handling.
- Framework render scheduling.
- DOM updates across four framework roots.

## What Improved

The previous demo mixed a header, sidebar, main panel, footer, metrics polling, history rendering, and duplicate ids. The simplified demo:

- Mounts each framework into an empty root.
- Uses one counter card per framework.
- Removes duplicate ids from interactive elements.
- Keeps shared status outside framework roots.

This cut visible p50 update time from roughly 68ms to roughly 32ms.

## Benchmark Script Shape

Use Playwright to measure:

```typescript
await page.locator('[data-action="react-inc"]').click();
await page.waitForFunction(() =>
  [...document.querySelectorAll('[data-counter]')]
    .every((node) => node.textContent?.trim() === '1')
);
```

Measure core dispatch separately:

```typescript
const t0 = performance.now();
await window.GaesupCore.dispatch('multi-framework-demo', 'MERGE', { count: next });
const elapsed = performance.now() - t0;
```

## Guidance

- Keep demo and benchmark DOM simple.
- Avoid polling when subscriptions can update state.
- Keep history arrays bounded.
- Use path subscriptions when components only need a small part of a store.
