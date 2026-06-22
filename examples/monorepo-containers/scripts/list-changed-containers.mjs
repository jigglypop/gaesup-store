import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const repoRoot = dirname(dirname(root));
const containersDir = join(root, 'containers');
const allContainers = readdirSync(containersDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

const args = parseArgs(process.argv.slice(2));
const base = args.base || process.env.BASE_SHA || defaultBase();
const head = args.head || process.env.HEAD_SHA || 'HEAD';
const files = args.files.length > 0 ? args.files : changedFiles(base, head);
const changed = new Set();
let validateAll = false;

for (const file of files) {
  const normalized = file.replaceAll('\\', '/');
  const match = normalized.match(/^examples\/monorepo-containers\/containers\/([^/]+)\//);
  if (match) {
    changed.add(match[1]);
    continue;
  }

  if (affectsAllContainerContracts(normalized)) {
    validateAll = true;
  }
}

const containers = validateAll
  ? allContainers
  : [...changed].filter((name) => existsSync(join(containersDir, name, 'manifest.json'))).sort();

const output = JSON.stringify(containers);
console.log(output);

if (process.env.GITHUB_OUTPUT) {
  const { appendFileSync } = await import('node:fs');
  appendFileSync(process.env.GITHUB_OUTPUT, `containers=${output}\n`);
  appendFileSync(process.env.GITHUB_OUTPUT, `has_changes=${containers.length > 0}\n`);
}

function changedFiles(baseRef, headRef) {
  try {
    const output = execFileSync('git', ['diff', '--name-only', `${baseRef}...${headRef}`], {
      cwd: repoRoot,
      encoding: 'utf8'
    });
    return output.split(/\r?\n/).filter(Boolean);
  } catch {
    const output = execFileSync('git', ['diff', '--name-only', headRef], {
      cwd: repoRoot,
      encoding: 'utf8'
    });
    return output.split(/\r?\n/).filter(Boolean);
  }
}

function defaultBase() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD~1'], {
      cwd: repoRoot,
      encoding: 'utf8'
    }).trim();
  } catch {
    return 'HEAD';
  }
}

function parseArgs(items) {
  const parsed = { files: [] };
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (item === '--base') parsed.base = items[++index];
    if (item === '--head') parsed.head = items[++index];
    if (item === '--files') parsed.files = parseFiles(items[++index] || '');
  }
  return parsed;
}

function parseFiles(value) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean);
  } catch {
    // Fall through to newline/comma parsing.
  }
  return value
    .replace(/^\[/, '')
    .replace(/\]$/, '')
    .split(/[\r\n,]+/)
    .map((item) => item.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean);
}

function affectsAllContainerContracts(normalizedPath) {
  return (
    normalizedPath === '.github/workflows/container-partial-deploy.yml' ||
    normalizedPath === 'examples/monorepo-containers/package.json' ||
    normalizedPath === 'examples/monorepo-containers/release-plan.json' ||
    normalizedPath.startsWith('examples/monorepo-containers/scripts/') ||
    normalizedPath.startsWith('packages/core/src/') ||
    normalizedPath.startsWith('packages/core/package.json') ||
    normalizedPath.startsWith('packages/core-rust/src/') ||
    normalizedPath.startsWith('packages/core-rust/Cargo.toml')
  );
}
