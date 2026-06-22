import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const args = parseArgs(process.argv.slice(2));

if (!args.slot || !args.previousRegistry) {
  console.error('Usage: pnpm rollback -- --slot <slot> --previous-registry <path>');
  process.exit(1);
}

const registry = await readJson(args.registry || 'dist/registry.json');
const previous = await readJson(args.previousRegistry);
const previousSlot = previous.slots?.[args.slot];

if (!previousSlot) {
  console.error(`Previous registry does not contain slot: ${args.slot}`);
  process.exit(1);
}

await verifySlotArtifact(previousSlot);

if (args.dryRun) {
  console.log(`VERIFIED_ROLLBACK ${args.slot} -> ${previousSlot.artifactPath || previousSlot.version}`);
  process.exit(0);
}

registry.slots ||= {};
registry.slots[args.slot] = {
  ...previousSlot,
  rolledBackAt: new Date().toISOString()
};
registry.updatedAt = new Date().toISOString();

await writeFile(join(root, args.registry || 'dist/registry.json'), `${JSON.stringify(registry, null, 2)}\n`);
console.log(`ROLLED_BACK ${args.slot} -> ${previousSlot.artifactPath || previousSlot.version}`);

function parseArgs(items) {
  const output = {};
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (item === '--slot') output.slot = items[++index];
    if (item === '--registry') output.registry = items[++index];
    if (item === '--previous-registry') output.previousRegistry = items[++index];
    if (item === '--dry-run') output.dryRun = true;
  }
  return output;
}

async function readJson(relativePath) {
  const raw = await readFile(join(root, relativePath), 'utf8');
  return JSON.parse(raw);
}

async function verifySlotArtifact(slot) {
  if (!slot.artifactPath || !slot.sha256) {
    throw new Error(`Previous slot ${slot.slot || args.slot} does not declare artifactPath and sha256`);
  }

  await verifyFileHash(slot.artifactPath, slot.sha256, 'artifact');

  if (slot.manifestPath && slot.manifestSha256) {
    await verifyFileHash(slot.manifestPath, slot.manifestSha256, 'manifest');
  }
}

async function verifyFileHash(relativePath, expectedHash, label) {
  const bytes = await readFile(resolveRegistryArtifactPath(relativePath));
  const actualHash = createHash('sha256').update(bytes).digest('hex');
  const expected = normalizeHash(expectedHash);
  if (actualHash !== expected) {
    throw new Error(`Rollback ${label} hash mismatch for ${relativePath}: expected ${expected}, got ${actualHash}`);
  }
}

function normalizeHash(value) {
  return String(value || '').trim().toLowerCase().replace(/^sha256:/, '');
}

function resolveRegistryArtifactPath(relativePath) {
  const artifactsRoot = resolve(root, 'dist', 'artifacts');
  const resolved = resolve(root, relativePath);
  if (!isInside(resolved, artifactsRoot)) {
    throw new Error(`Rollback artifact path must stay inside dist/artifacts: ${relativePath}`);
  }
  return resolved;
}

function isInside(target, parent) {
  return target === parent || target.startsWith(`${parent}${sep}`);
}
