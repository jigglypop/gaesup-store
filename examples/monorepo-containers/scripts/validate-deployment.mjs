import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const wasm = require('gaesup-state-core-rust/node');

wasm.init();

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const hostDeployment = await readJson('release-plan.json');

const host = {
  abiVersion: '1.0.0',
  defaultConflictPolicy: 'reject',
  dependencies: [
    { name: 'date-fns', version: '2.30.0' },
    { name: 'zod', version: '3.23.8' },
    { name: 'chart.js', version: '4.4.3' }
  ],
  stores: [
    { storeId: 'session', schemaId: 'session-state', schemaVersion: '1.0.0' },
    { storeId: 'cart', schemaId: 'cart-state', schemaVersion: '1.2.1' },
    { storeId: 'recommendations', schemaId: 'recommendation-state', schemaVersion: '1.0.0' }
  ],
  deployment: hostDeployment
};

const scenarios = [
  ['shell', 'containers/shell/manifest.json', true],
  ['header', 'containers/header/manifest.json', true],
  ['body', 'containers/body/manifest.json', true],
  ['sidebar', 'containers/sidebar/manifest.json', true],
  ['body release drift', 'containers/body/manifest.release-drift.json', false],
  ['body contract drift', 'containers/body/manifest.contract-drift.json', false]
];

let failed = false;

for (const [label, file, expectedValid] of scenarios) {
  const manifest = await readJson(file);
  const result = wasm.validate_manifest(manifest, host);
  const status = result.valid ? 'OK' : 'BLOCKED';
  const expectedStatus = expectedValid ? 'OK' : 'BLOCKED';

  console.log(`${status.padEnd(7)} ${label}`);

  for (const issue of result.errors) {
    console.log(`        ${issue.code}: ${issue.message}`);
  }
  for (const issue of result.warnings) {
    console.log(`        ${issue.code}: ${issue.message}`);
  }

  if (status !== expectedStatus) {
    failed = true;
    console.error(`        expected ${expectedStatus}, got ${status}`);
  }
}

if (failed) {
  process.exitCode = 1;
}

async function readJson(relativePath) {
  const raw = await readFile(join(root, relativePath), 'utf8');
  return JSON.parse(raw);
}
