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
const files = changedFiles(base, head);
const changed = new Set();
let validateAll = false;

for (const file of files) {
  const normalized = file.replaceAll('\\', '/');
  const match = normalized.match(/^examples\/monorepo-containers\/containers\/([^/]+)\//);
  if (match) {
    changed.add(match[1]);
    continue;
  }

  if (
    normalized === 'examples/monorepo-containers/release-plan.json' ||
    normalized === 'examples/monorepo-containers/scripts/validate-affected-deployment.mjs' ||
    normalized === 'examples/monorepo-containers/scripts/list-changed-containers.mjs'
  ) {
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
  const parsed = {};
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (item === '--base') parsed.base = items[++index];
    if (item === '--head') parsed.head = items[++index];
  }
  return parsed;
}
