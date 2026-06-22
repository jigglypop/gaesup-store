#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const benchmarks = [
  'state-contract-runtime.mjs',
  'gaesup-bottleneck-probe.mjs',
  'compare-state-libraries.mjs'
].filter((file) => existsSync(join(root, file)));

let failed = false;

for (const file of benchmarks) {
  console.log(`\n[gaesup-bench] ${file}`);
  const result = spawnSync(process.execPath, [join(root, file)], {
    stdio: 'inherit',
    env: {
      ...process.env,
      NODE_OPTIONS: process.env.NODE_OPTIONS || '--max-old-space-size=4096'
    }
  });

  if (result.status !== 0) {
    failed = true;
    console.error(`[gaesup-bench] ${file} failed with exit code ${result.status}`);
  }
}

if (benchmarks.length === 0) {
  console.warn('[gaesup-bench] No benchmark files were found.');
}

process.exitCode = failed ? 1 : 0;
