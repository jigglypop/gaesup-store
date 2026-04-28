const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const runRoot = path.join(root, '.codex-run');
const packDir = path.join(runRoot, 'npm-pack');
const smokeDir = path.join(runRoot, 'npm-smoke');

function run(command, args, options = {}) {
  if (os.platform() === 'win32') {
    execFileSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', [command, ...args].map(quoteCmdArg).join(' ')], {
      cwd: options.cwd || root,
      stdio: 'inherit'
    });
    return;
  }

  execFileSync(command, args, {
    cwd: options.cwd || root,
    stdio: 'inherit'
  });
}

function quoteCmdArg(value) {
  const text = String(value);
  if (/^[A-Za-z0-9_@%+=:,./\\-]+$/.test(text)) return text;
  return `"${text.replace(/"/g, '\\"')}"`;
}

function resetDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
}

resetDir(packDir);
resetDir(smokeDir);

run('pnpm', ['--filter', 'gaesup-state', 'run', 'build']);
run('pnpm', ['--filter', 'gaesup-state-core-rust', 'run', 'prepare:npm-files']);

run('npm', ['pack', '--pack-destination', packDir], {
  cwd: path.join(root, 'packages/core-rust')
});
run('npm', ['pack', '--pack-destination', packDir], {
  cwd: path.join(root, 'packages/core')
});

const tarballs = fs
  .readdirSync(packDir)
  .filter((file) => file.endsWith('.tgz'))
  .map((file) => path.join(packDir, file));

if (tarballs.length !== 2) {
  throw new Error(`Expected 2 tarballs, found ${tarballs.length}`);
}

run('npm', ['init', '-y'], { cwd: smokeDir });
run('npm', ['install', ...tarballs], { cwd: smokeDir });

const smokeFile = path.join(smokeDir, 'smoke.mjs');
fs.writeFileSync(
  smokeFile,
  [
    "import { gaesup, resource, GaesupCore } from 'gaesup-state';",
    "import initWeb from 'gaesup-state-core-rust/web';",
    "import * as wasmNode from 'gaesup-state-core-rust/node';",
    "if (typeof gaesup !== 'function') throw new Error('gaesup export missing');",
    "if (typeof resource !== 'function') throw new Error('resource export missing');",
    "if (typeof GaesupCore.pipeline !== 'function') throw new Error('pipeline export missing');",
    "if (typeof initWeb !== 'function') throw new Error('web wasm init export missing');",
    "if (typeof wasmNode.create_store !== 'function') throw new Error('node wasm create_store export missing');",
    "wasmNode.create_store('smoke', { count: 0 });",
    "wasmNode.dispatch('smoke', 'MERGE', { count: 1 });",
    "if (wasmNode.select('smoke', 'count') !== 1) throw new Error('node wasm store smoke failed');",
    "console.log('npm smoke import ok');",
    ''
  ].join('\n')
);

run('node', ['smoke.mjs'], { cwd: smokeDir });
