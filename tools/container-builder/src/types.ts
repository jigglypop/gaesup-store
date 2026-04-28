export type WASMRuntimeType =
  | 'wasmtime'
  | 'wasmedge'
  | 'wasmer'
  | 'browser'
  | 'nodejs'

export type DependencyConflictPolicy =
  | 'reject'
  | 'isolate'
  | 'migrate'
  | 'readonly'

export interface PackageDependencyContract {
  name: string
  version: string
  optional?: boolean
  source?: 'host' | 'bundled'
}

export interface StoreDependencyContract {
  storeId: string
  schemaId: string
  schemaVersion: string
  compatRange?: string
  required?: boolean
  conflictPolicy?: DependencyConflictPolicy
  writablePaths?: string[]
  readonlyPaths?: string[]
}

export interface ContainerPermissionContract {
  network?: boolean
  storage?: 'none' | 'scoped' | 'host'
  dom?: boolean
  crossStore?: boolean
  crossContainer?: boolean
}

export interface ContainerLayer {
  type: 'file' | 'wasm'
  source: string
  destination: string
  hash: string
  size: number
  mediaType: string
  entrypoint?: string
}

export interface BuildOptions {
  outputPath: string
  compress?: boolean
}

export interface ContainerImageLayer {
  digest: string
  size: number
  mediaType: string
}

export interface ContainerManifest {
  manifestVersion: '1.0'
  name: string
  version: string
  tag: string
  architecture: 'wasm32'
  os: 'wasi' | 'unknown'
  created: string
  size?: number
  runtime?: WASMRuntimeType
  wasm?: {
    entrypoint?: string
    sha256?: string
    size?: number
  }
  gaesup: {
    abiVersion: string
    minHostVersion?: string
  }
  dependencies: PackageDependencyContract[]
  stores: StoreDependencyContract[]
  permissions: ContainerPermissionContract
  allowedImports: string[]
  layers: ContainerImageLayer[]
  config: {
    runtime: WASMRuntimeType
    maxMemory: number
    maxCpuTime: number
    allowedImports?: string[]
    persistentData?: boolean
    networkAccess?: boolean
    environment?: Record<string, string>
    entrypoint?: string
    labels?: Record<string, string>
    isolation: {
      memoryIsolation: boolean
      fileSystemAccess: boolean
      crossContainerComm: boolean
      syscallFilter?: string[]
      capabilities?: string[]
    }
  }
}
