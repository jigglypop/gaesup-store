import { randomUUID } from 'crypto';
import type { Readable } from 'stream';
import { RegistryStorage } from '../storage/RegistryStorage';
import type { ContainerRecord } from '../types';

type UploadRecord = {
  name: string;
  createdAt: string;
};

export class ContainerRepository {
  constructor(private readonly storage: RegistryStorage) {}

  async listContainers(limit?: number, last?: string) {
    const names = await this.storage.list('repositories');
    const start = last ? names.findIndex((name) => name === last) + 1 : 0;
    const sliced = names.slice(Math.max(start, 0));
    return typeof limit === 'number' ? sliced.slice(0, limit) : sliced;
  }

  async listTags(name: string) {
    return this.storage.list(`repositories/${name}/manifests`);
  }

  async getManifest(name: string, reference: string) {
    return this.storage.readJson(`repositories/${name}/manifests/${reference}/manifest.json`);
  }

  async putManifest(name: string, reference: string, manifest: unknown) {
    await this.storage.writeJson(`repositories/${name}/manifests/${reference}/manifest.json`, manifest);
    await this.touchRecord(name, reference);
  }

  async startBlobUpload(name: string) {
    const uploadId = randomUUID();
    await this.storage.writeJson(`uploads/${uploadId}.json`, {
      name,
      createdAt: new Date().toISOString()
    } satisfies UploadRecord);
    return uploadId;
  }

  async completeBlobUpload(name: string, uuid: string, digest: string, stream: Readable) {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    await this.storage.writeBlob(`repositories/${name}/blobs/${encodeDigest(digest)}`, Buffer.concat(chunks));
    await this.storage.delete(`uploads/${uuid}.json`);
  }

  async getBlob(name: string, digest: string) {
    return this.storage.readBlob(`repositories/${name}/blobs/${encodeDigest(digest)}`);
  }

  async searchContainers(query = '', limit = 10, offset = 0) {
    const names = await this.listContainers();
    const normalized = query.toLowerCase();
    const filtered = names.filter((name) => !normalized || name.toLowerCase().includes(normalized));
    return {
      total: filtered.length,
      results: filtered.slice(Number(offset), Number(offset) + Number(limit))
    };
  }

  async getContainerInfo(name: string) {
    const record = await this.storage.readJson<ContainerRecord>(`repositories/${name}/record.json`);
    return record;
  }

  async getContainerStats(name: string) {
    const record = await this.getContainerInfo(name);
    return {
      name,
      tags: record?.tags.length || 0,
      downloads: record?.downloads || 0,
      updatedAt: record?.updatedAt
    };
  }

  async getPopularContainers(limit = 10) {
    const records = await this.getRecords();
    return records.sort((a, b) => b.downloads - a.downloads).slice(0, Number(limit));
  }

  async getRecentContainers(limit = 10) {
    const records = await this.getRecords();
    return records
      .sort((a, b) => Date.parse(b.updatedAt || '') - Date.parse(a.updatedAt || ''))
      .slice(0, Number(limit));
  }

  async deleteContainer(name: string) {
    await this.storage.delete(`repositories/${name}`);
  }

  async deleteTag(name: string, tag: string) {
    await this.storage.delete(`repositories/${name}/manifests/${tag}`);
    const tags = await this.listTags(name);
    const record = await this.getContainerInfo(name);
    if (record) {
      await this.storage.writeJson(`repositories/${name}/record.json`, {
        ...record,
        tags,
        latestTag: tags.at(-1),
        updatedAt: new Date().toISOString()
      });
    }
  }

  async triggerBuild(name: string, repository: string, branch: string) {
    const buildId = randomUUID();
    await this.storage.writeJson(`builds/${buildId}.json`, {
      buildId,
      name,
      repository,
      branch,
      status: 'queued',
      createdAt: new Date().toISOString()
    });
    return buildId;
  }

  private async touchRecord(name: string, tag: string) {
    const previous = await this.getContainerInfo(name);
    const tags = new Set(previous?.tags || []);
    tags.add(tag);
    await this.storage.writeJson(`repositories/${name}/record.json`, {
      name,
      tags: [...tags],
      latestTag: tag,
      downloads: previous?.downloads || 0,
      updatedAt: new Date().toISOString()
    } satisfies ContainerRecord);
  }

  private async getRecords() {
    const names = await this.listContainers();
    const records = await Promise.all(names.map((name) => this.getContainerInfo(name)));
    return records.filter((record): record is ContainerRecord => Boolean(record));
  }
}

function encodeDigest(digest: string) {
  return digest.replace(':', '/');
}
