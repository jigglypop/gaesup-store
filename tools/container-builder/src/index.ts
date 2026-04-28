import { readFile } from 'fs/promises';
import { basename, resolve } from 'path';
import { ContainerBuilder } from './builder/ContainerBuilder';

export { ContainerBuilder } from './builder/ContainerBuilder';
export type {
  AcceleratorDependencyContract,
  BuildOptions,
  ContainerImageLayer,
  ContainerLayer,
  ContainerManifest,
  ContainerPermissionContract,
  DependencyConflictPolicy,
  PackageDependencyContract,
  StoreDependencyContract,
  WASMRuntimeType
} from './types';

export interface BuildCommandOptions {
  context?: string;
  dockerfile?: string;
  output?: string;
  name?: string;
  tag?: string;
  compress?: boolean;
}

export async function buildContainerImage(options: BuildCommandOptions = {}) {
  const context = resolve(options.context || process.cwd());
  const output = resolve(options.output || 'dist/container.gpkg');
  const builder = new ContainerBuilder(context);
  const tag = options.tag || 'latest';
  const name = options.name || basename(context);

  builder.setNameAndTag(name, tag);

  if (options.dockerfile) {
    await builder.fromDockerfile(resolve(context, options.dockerfile));
  } else {
    await loadGaesupContainerFile(builder, context);
  }

  const digest = await builder.build({
    outputPath: output,
    compress: options.compress !== false
  });

  return { digest, output };
}

async function loadGaesupContainerFile(builder: ContainerBuilder, context: string) {
  const configPath = resolve(context, 'gaesup.container.json');
  const config = JSON.parse(await readFile(configPath, 'utf8')) as {
    name?: string;
    tag?: string;
    runtime?: string;
    wasm?: string;
    entrypoint?: string;
    files?: Array<{ source: string; destination: string }>;
  };

  if (config.name) {
    builder.setNameAndTag(config.name, config.tag || 'latest');
  }
  if (config.runtime) {
    builder.setRuntime(config.runtime);
  }
  if (config.wasm) {
    await builder.addWasmBinary(config.wasm, config.entrypoint);
  }
  for (const file of config.files || []) {
    await builder.addFile(file.source, file.destination);
  }
}
