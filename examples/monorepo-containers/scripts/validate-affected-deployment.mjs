import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const wasm = require('gaesup-state-core-rust/node');

wasm.init();

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const requestedContainers = parseContainers(process.argv.slice(2));
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

if (requestedContainers.length === 0) {
  console.log('No affected containers to validate');
  process.exit(0);
}

let failed = false;

for (const container of requestedContainers) {
  const manifestPath = `containers/${container}/manifest.json`;
  const manifest = await readJson(manifestPath);
  const result = wasm.validate_manifest(manifest, host);
  const status = result.valid ? 'OK' : 'BLOCKED';

  console.log(`${status.padEnd(7)} ${container}`);

  for (const issue of result.errors) {
    console.log(`        ${issue.code}: ${issue.message}`);
  }
  for (const issue of result.warnings) {
    console.log(`        ${issue.code}: ${issue.message}`);
  }

  if (!result.valid) {
    failed = true;
  }
}

if (failed) {
  process.exitCode = 1;
}

function parseContainers(args) {
  const fromFlag = args.findIndex((arg) => arg === '--containers');
  if (fromFlag >= 0) {
    return parseList(args[fromFlag + 1] || '');
  }

  const fromEnv = process.env.CONTAINERS || process.env.AFFECTED_CONTAINERS || '';
  return parseList(fromEnv);
}

function parseList(value) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean);
  } catch {
    // Fall through to comma parsing.
  }
  return value
    .replace(/^\[/, '')
    .replace(/\]$/, '')
    .split(',')
    .map((item) => item.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean);
}

async function readJson(relativePath) {
  const raw = await readFile(join(root, relativePath), 'utf8');
  return JSON.parse(raw);
}
