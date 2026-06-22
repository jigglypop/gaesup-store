import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
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
  }
  return output;
}

async function readJson(relativePath) {
  const raw = await readFile(join(root, relativePath), 'utf8');
  return JSON.parse(raw);
}
