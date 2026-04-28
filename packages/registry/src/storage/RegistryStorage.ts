import { mkdir, readFile, readdir, rm, stat, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import type { RegistryStorageConfig } from '../types';

export class RegistryStorage {
  constructor(private readonly config: RegistryStorageConfig) {}

  async initialize() {
    await mkdir(this.config.path, { recursive: true });
  }

  async close() {
    return undefined;
  }

  async getHealth() {
    await this.initialize();
    const info = await stat(this.config.path);
    return {
      type: this.config.type,
      path: this.config.path,
      writable: info.isDirectory()
    };
  }

  async readJson<T>(path: string): Promise<T | undefined> {
    try {
      return JSON.parse(await readFile(this.resolve(path), 'utf8')) as T;
    } catch (error) {
      if (isNotFound(error)) return undefined;
      throw error;
    }
  }

  async writeJson(path: string, value: unknown) {
    const target = this.resolve(path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, JSON.stringify(value, null, 2));
  }

  async readBlob(path: string) {
    try {
      return await readFile(this.resolve(path));
    } catch (error) {
      if (isNotFound(error)) return undefined;
      throw error;
    }
  }

  async writeBlob(path: string, value: Buffer) {
    const target = this.resolve(path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, value);
  }

  async list(path: string) {
    try {
      return await readdir(this.resolve(path));
    } catch (error) {
      if (isNotFound(error)) return [];
      throw error;
    }
  }

  async delete(path: string) {
    await rm(this.resolve(path), { recursive: true, force: true });
  }

  private resolve(path: string) {
    return join(this.config.path, path);
  }
}

function isNotFound(error: unknown) {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === 'ENOENT';
}
