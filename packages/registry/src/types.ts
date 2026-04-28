export interface RegistryConfig {
  port: number;
  host: string;
  storage: RegistryStorageConfig;
  auth: RegistryAuthConfig;
  metrics: RegistryMetricsConfig;
  cors: Record<string, any>;
  rateLimit: Record<string, any>;
}

export interface RegistryStorageConfig {
  type: 'filesystem';
  path: string;
}

export interface RegistryAuthConfig {
  enabled: boolean;
  type: 'basic';
  username?: string | undefined;
  password?: string | undefined;
}

export interface RegistryMetricsConfig {
  enabled: boolean;
  endpoint: string;
}

export interface ContainerRecord {
  name: string;
  tags: string[];
  latestTag?: string;
  updatedAt?: string;
  downloads: number;
}
