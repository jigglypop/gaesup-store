#!/usr/bin/env node
import { access } from 'node:fs/promises';
import { spawn } from 'node:child_process';

const requiredArtifacts = [
  'packages/core-rust/pkg-node/gaesup_state_core.js'
];

const suites = [
  ['state library comparison', 'benchmarks/compare-state-libraries.mjs'],
  ['gaesup bottleneck probe', 'benchmarks/gaesup-bottleneck-probe.mjs']
];

for (const artifact of requiredArtifacts) {
  try {
    await access(artifact);
  } catch {
    console.error(`Missing benchmark artifact: ${artifact}`);
    console.error('Run `pnpm run build:wasm` before running benchmarks.');
    process.exit(1);
  }
}

for (const [name, file] of suites) {
  console.log(`\nRunning ${name}`);
  await runNode(file);
}

function runNode(file) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [file], {
      stdio: 'inherit'
    });

    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${file} exited with ${code}`));
    });
  });
}
