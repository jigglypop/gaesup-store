import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const args = parseArgs(process.argv.slice(2));
const containers = parseContainers(args);
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
  const manifestSha256 = createHash('sha256').update(manifestRaw).digest('hex');
  const artifact = await verifyDeclaredArtifact(container, manifest);

  if (args.dryRun) {
    console.log(`VERIFIED ${slot} -> ${artifact.fileName} sha256:${artifact.sha256}`);
    continue;
  }

  const manifestArtifactPath = registryArtifactPath(slot, manifest.version, 'manifest.json');
  const manifestArtifactFile = resolveInsideRoot(manifestArtifactPath);
  const wasmArtifactPath = registryArtifactPath(slot, manifest.version, artifact.fileName);
  const wasmArtifactFile = resolveInsideRoot(wasmArtifactPath);
  await mkdir(dirname(manifestArtifactFile), { recursive: true });
  await writeFile(manifestArtifactFile, manifestRaw);
  await writeFile(wasmArtifactFile, artifact.bytes);

  registry.slots[slot] = {
    slot,
    packageName: manifest.name,
    version: manifest.version,
    releaseId: manifest.deployment?.releaseId || releasePlan.releaseId,
    slotVersion: manifest.deployment?.slotVersion || manifest.version,
    contractVersion: manifest.deployment?.contractVersion,
    manifestPath: manifestArtifactPath,
    manifestSha256,
    artifactPath: wasmArtifactPath,
    sha256: artifact.sha256,
    updatedAt: new Date().toISOString()
  };

  console.log(`UPDATED ${slot} -> ${wasmArtifactPath} sha256:${artifact.sha256}`);
}

if (!args.dryRun) {
  registry.releaseId = releasePlan.releaseId;
  registry.updatedAt = new Date().toISOString();
  await mkdir(join(root, 'dist'), { recursive: true });
  await writeFile(join(root, registryPath), `${JSON.stringify(registry, null, 2)}\n`);
}

function parseArgs(items) {
  const output = { dryRun: false, containers: '' };
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (item === '--containers') output.containers = items[++index] || '';
    if (item === '--dry-run') output.dryRun = true;
  }
  return output;
}

function parseContainers(args) {
  if (args.containers) return parseList(args.containers);
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

async function verifyDeclaredArtifact(container, manifest) {
  if (manifest.runtime !== 'wasm' && manifest.runtime !== 'wasm-worker') {
    throw new Error(`Container ${container} must declare a wasm runtime artifact before registry update`);
  }

  const declaredPath = manifest.wasm?.path || manifest.entry?.path || manifest.entry?.url;
  const declaredHash = normalizeHash(manifest.wasm?.sha256 || manifest.entry?.sha256);
  if (!declaredPath || !declaredHash) {
    throw new Error(`Container ${container} must declare wasm.path and wasm.sha256 before registry update`);
  }
  const artifactFile = resolveContainerArtifactPath(container, declaredPath);
  const bytes = await readFile(artifactFile);
  const actualHash = createHash('sha256').update(bytes).digest('hex');
  if (actualHash !== declaredHash) {
    throw new Error(`Container ${container} artifact hash mismatch: expected ${declaredHash}, got ${actualHash}`);
  }

  return {
    bytes,
    sha256: actualHash,
    fileName: safePathSegment(basename(declaredPath), 'artifact filename')
  };
}

function normalizeHash(value) {
  return String(value || '').trim().toLowerCase().replace(/^sha256:/, '');
}

function resolveContainerArtifactPath(container, declaredPath) {
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(declaredPath)) {
    throw new Error(`Container ${container} artifact path must be a local path inside the container directory`);
  }

  const containerDir = resolve(root, 'containers', container);
  const artifactPath = resolve(containerDir, declaredPath);
  if (!isInside(artifactPath, containerDir)) {
    throw new Error(`Container ${container} artifact path must stay inside the container directory`);
  }
  return artifactPath;
}

function registryArtifactPath(slot, version, fileName) {
  return [
    'dist',
    'artifacts',
    safePathSegment(slot, 'slot'),
    safePathSegment(version, 'version'),
    safePathSegment(fileName, 'artifact filename')
  ].join('/');
}

function safePathSegment(value, label) {
  const segment = String(value || '').trim();
  if (!segment || segment === '.' || segment === '..' || /[\\/]/.test(segment)) {
    throw new Error(`Invalid ${label} path segment: ${value}`);
  }
  return segment;
}

function resolveInsideRoot(relativePath) {
  const resolved = resolve(root, relativePath);
  if (!isInside(resolved, root)) {
    throw new Error(`Path must stay inside monorepo container root: ${relativePath}`);
  }
  return resolved;
}

function isInside(target, parent) {
  return target === parent || target.startsWith(`${parent}${sep}`);
}
