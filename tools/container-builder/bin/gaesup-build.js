#!/usr/bin/env node
import { buildContainerImage } from '../dist/index.js';

const options = parseArgs(process.argv.slice(2));

buildContainerImage(options)
  .then(({ digest, output }) => {
    console.log(`Built ${output}`);
    console.log(`sha256:${digest}`);
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });

function parseArgs(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--context' || arg === '-c') options.context = args[++index];
    if (arg === '--dockerfile' || arg === '-f') options.dockerfile = args[++index];
    if (arg === '--output' || arg === '-o') options.output = args[++index];
    if (arg === '--name') options.name = args[++index];
    if (arg === '--tag' || arg === '-t') options.tag = args[++index];
    if (arg === '--no-compress') options.compress = false;
  }
  return options;
}
