const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const wasmDirs = [
  path.join(root, 'packages/core-rust/pkg'),
  path.join(root, 'packages/core-rust/pkg-web'),
  path.join(root, 'packages/core-rust/pkg-node')
];

const npmignore = [
  '!.npmignore',
  '!package.json',
  '!*.js',
  '!*.d.ts',
  '!*.wasm',
  '!snippets/**',
  ''
].join('\n');

for (const dir of wasmDirs) {
  if (!fs.existsSync(dir)) continue;
  fs.writeFileSync(path.join(dir, '.npmignore'), npmignore);
}
