import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const containers = parseContainers(process.argv.slice(2));
const releasePlan = await readJson('release-plan.json');
const registryPath = 'dist/registry.json';
const registry = await readJsonIfExists(registryPath, {
  releaseId: releasePlan.releaseId,
  updatedAt: null,
  slots: {}
});

if (containers.length === 0) {
  console.log('No affected containers to deploy');
  process.exit(0);
}

for (const container of containers) {
  const manifestPath = `containers/${container}/manifest.json`;
  const manifestRaw = await readFile(join(root, manifestPath));
  const manifest = JSON.parse(manifestRaw.toString('utf8'));
  const slot = manifest.deployment?.slot || container;
  const sha256 = createHash('sha256').update(manifestRaw).digest('hex');
  const artifactPath = `dist/artifacts/${slot}/${manifest.version}/manifest.json`;
  const artifactFile = join(root, artifactPath);
  await mkdir(dirname(artifactFile), { recursive: true });
  await writeFile(artifactFile, manifestRaw);

  registry.slots[slot] = {
    slot,
    packageName: manifest.name,
    version: manifest.version,
    releaseId: manifest.deployment?.releaseId || releasePlan.releaseId,
    slotVersion: manifest.deployment?.slotVersion || manifest.version,
    contractVersion: manifest.deployment?.contractVersion,
    artifactPath,
    sha256,
    updatedAt: new Date().toISOString()
  };

  console.log(`UPDATED ${slot} -> ${artifactPath} sha256:${sha256}`);
}

registry.releaseId = releasePlan.releaseId;
registry.updatedAt = new Date().toISOString();
await mkdir(join(root, 'dist'), { recursive: true });
await writeFile(join(root, registryPath), `${JSON.stringify(registry, null, 2)}\n`);

function parseContainers(args) {
  const fromFlag = args.findIndex((arg) => arg === '--containers');
  if (fromFlag >= 0) return parseList(args[fromFlag + 1] || '');
  return parseList(process.env.CONTAINERS || process.env.AFFECTED_CONTAINERS || '');
}

function parseList(value) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean);
  } catch {}
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

async function readJsonIfExists(relativePath, fallback) {
  try {
    return await readJson(relativePath);
  } catch {
    return fallback;
  }
}
