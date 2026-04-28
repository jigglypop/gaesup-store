import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test('multi-framework demo exposes its browser entry point', async () => {
  const html = await readFile('examples/multi-framework-demo/index.html', 'utf8');

  expect(html).toContain('id="react-counter"');
  expect(html).toContain('id="vue-counter"');
  expect(html).toContain('id="svelte-counter"');
  expect(html).toContain('id="angular-counter"');
  expect(html).toContain('/src/main.ts');
});
