import type {
  ContainerConfig,
  ContainerManagerConfig,
  ContainerID,
  ContainerPackageManifest,
  StateCallback,
  Unsubscribe,
  WASMRuntimeType
} from '../types'
import { ContainerInstance } from './ContainerInstance'
import { EventBus } from '../events/EventBus'
import { RuntimeFactory } from '../runtime/RuntimeFactory'
import { CompatibilityGuard } from '../compat/CompatibilityGuard'
import { ContainerCompatibilityError, ContainerNotFoundError, ContainerStartupError } from '../errors'

export class ContainerManager {
  private readonly config: Required<ContainerManagerConfig>
  private readonly containers: Map<ContainerID, ContainerInstance> = new Map()
  private readonly eventBus: EventBus
  private readonly runtimeFactory: RuntimeFactory
  private readonly compatibilityGuard: CompatibilityGuard
  private readonly containerCache: Map<string, WebAssembly.Module> = new Map()

  constructor(config: ContainerManagerConfig = {}) {
    this.config = {
      registry: config.registry || 'https://registry.gaesup.dev',
      maxContainers: config.maxContainers || 10,
      defaultRuntime: config.defaultRuntime || 'wasmtime',
      cacheSize: config.cacheSize || 100 * 1024 * 1024, // 100MB
      debugMode: config.debugMode || false,
      enableMetrics: config.enableMetrics || true,
      networkTimeout: config.networkTimeout || 5000,
      compatibility: config.compatibility || {}
    }

    this.eventBus = new EventBus(this.config.debugMode)
    this.runtimeFactory = new RuntimeFactory()
    this.compatibilityGuard = new CompatibilityGuard(this.config.compatibility)

    if (this.config.debugMode) {
      console.log('[ContainerManager] Initialized with config:', this.config)
    }
  }

  async run(name: string, config: ContainerConfig = {}): Promise<ContainerInstance> {
    try {
      // 컨테이너 수 제한 체크
      if (this.containers.size >= this.config.maxContainers) {
        throw new Error(`Maximum container limit reached (${this.config.maxContainers})`)
      }

      // 컨테이너 ID 생성
      const containerId = this.generateContainerId(name)
      
      if (this.config.debugMode) {
        console.log(`[ContainerManager] Starting container: ${name} (ID: ${containerId})`)
      }

      // WASM 모듈 로드 또는 캐시에서 가져오기
      const manifest = await this.resolveManifest(name, config)
      const runtimeConfig = this.applyManifestDefaults(config, manifest)
      this.validateCompatibility(containerId, manifest)
      const wasmModule = await this.loadWASMModule(name, runtimeConfig)
      
      // 런타임 선택 및 인스턴스 생성
      const runtime = runtimeConfig.runtime || this.config.defaultRuntime
      const wasmInstance = await this.createWASMInstance(wasmModule, runtime, runtimeConfig)

      // 컨테이너 인스턴스 생성
      const container = new ContainerInstance(
        containerId,
        name,
        this.parseVersion(name),
        wasmModule,
        wasmInstance,
        runtimeConfig,
        this.eventBus
      )

      // 컨테이너 등록
      this.containers.set(containerId, container)

      // 메트릭 수집 시작
      if (this.config.enableMetrics) {
        this.startMetricsCollection(container)
      }

      // 이벤트 발행
      this.eventBus.emit('container:created', {
        containerId,
        name,
        config: runtimeConfig
      })

      if (this.config.debugMode) {
        console.log(`[ContainerManager] Container started successfully: ${containerId}`)
      }

      return container

    } catch (error) {
      const errorMessage = `Failed to start container ${name}: ${getErrorMessage(error)}`
      
      if (this.config.debugMode) {
        console.error(`[ContainerManager] ${errorMessage}`, error)
      }

      throw new ContainerStartupError('unknown', errorMessage, { originalError: error })
    }
  }

  async stop(containerId: ContainerID): Promise<void> {
    const container = this.containers.get(containerId)
    
    if (!container) {
      throw new ContainerNotFoundError(containerId)
    }

    try {
      await container.stop()
      this.containers.delete(containerId)

      this.eventBus.emit('manager:container_removed', {
        containerId,
        name: container.name
      })

      if (this.config.debugMode) {
        console.log(`[ContainerManager] Container stopped: ${containerId}`)
      }

    } catch (error) {
      console.error(`[ContainerManager] Error stopping container ${containerId}:`, error)
      throw error
    }
  }

  list(): ContainerInstance[] {
    return Array.from(this.containers.values())
  }

  get(containerId: ContainerID): ContainerInstance | undefined {
    return this.containers.get(containerId)
  }

  subscribe(containerId: ContainerID, callback: StateCallback): Unsubscribe {
    const container = this.containers.get(containerId)
    
    if (!container) {
      throw new ContainerNotFoundError(containerId)
    }

    return container.subscribe(callback)
  }

  async cleanup(): Promise<void> {
    if (this.config.debugMode) {
      console.log(`[ContainerManager] Cleaning up ${this.containers.size} containers`)
    }

    const stopPromises = Array.from(this.containers.keys()).map(
      containerId => this.stop(containerId)
    )

    await Promise.allSettled(stopPromises)

    // 캐시 정리
    this.containerCache.clear()

    // 이벤트 버스 정리
    this.eventBus.removeAllListeners()

    if (this.config.debugMode) {
      console.log('[ContainerManager] Cleanup completed')
    }
  }

  // 컨테이너 메트릭 조회
  getMetrics(): Record<ContainerID, any> {
    const metrics: Record<ContainerID, any> = {}
    
    this.containers.forEach((container, id) => {
      metrics[id] = {
        id,
        name: container.name,
        status: container.status,
        metrics: container.metrics
      }
    })

    return metrics
  }

  // 헬스 체크
  async healthCheck(): Promise<Record<ContainerID, any>> {
    const healthChecks: Record<ContainerID, any> = {}
    
    const promises = Array.from(this.containers.entries()).map(
      async ([id, container]) => {
        try {
          const health = await container.healthCheck()
          healthChecks[id] = health
        } catch (error) {
          healthChecks[id] = {
            healthy: false,
            lastCheck: new Date(),
            error: getErrorMessage(error)
          }
        }
      }
    )

    await Promise.all(promises)
    return healthChecks
  }

  private generateContainerId(name: string): ContainerID {
    const timestamp = Date.now()
    const random = Math.random().toString(36).substring(2, 8)
    return `${name.replace(/[^a-zA-Z0-9]/g, '-')}-${timestamp}-${random}`
  }

  private parseVersion(name: string): string {
    const match = name.match(/:(.+)$/)
    return match ? match[1] : 'latest'
  }

  private async resolveManifest(
    name: string,
    config: ContainerConfig
  ): Promise<ContainerPackageManifest> {
    if (config.manifest) {
      return config.manifest
    }

    const url = `${this.config.registry}/containers/${name}/manifest.json`

    try {
      const response = await fetch(url)

      if (!response.ok) {
        throw new Error(`Failed to download manifest: ${response.status} ${response.statusText}`)
      }

      return await response.json()
    } catch (error) {
      throw new Error(`Manifest download failed for ${name}: ${getErrorMessage(error)}`)
    }
  }

  private applyManifestDefaults(
    config: ContainerConfig,
    manifest: ContainerPackageManifest
  ): ContainerConfig {
    const runtimeConfig: ContainerConfig = {
      ...config,
      networkAccess: config.networkAccess ?? manifest.permissions?.network ?? false,
      isolation: config.isolation || {
        memoryIsolation: true,
        fileSystemAccess: false,
        crossContainerComm: manifest.permissions?.crossContainer ?? false
      },
      manifest
    }

    if (config.runtime) {
      runtimeConfig.runtime = config.runtime
    } else if (manifest.runtime) {
      runtimeConfig.runtime = manifest.runtime
    }

    if (config.allowedImports) {
      runtimeConfig.allowedImports = config.allowedImports
    } else if (manifest.allowedImports) {
      runtimeConfig.allowedImports = manifest.allowedImports
    }

    return runtimeConfig
  }

  private validateCompatibility(
    containerId: ContainerID,
    manifest: ContainerPackageManifest
  ): void {
    const decision = this.compatibilityGuard.validate(manifest)

    if (decision.valid && !decision.isolatedStores.length && !decision.readonlyStores.length) {
      return
    }

    if (decision.valid) {
      throw new ContainerCompatibilityError(
        containerId,
        'Store conflict policy requires runtime enforcement that is not enabled yet',
        { manifest, decision }
      )
    }

    throw new ContainerCompatibilityError(
      containerId,
      decision.errors.map((error) => error.message).join('; '),
      { manifest, decision }
    )
  }

  private async loadWASMModule(name: string, config: ContainerConfig): Promise<WebAssembly.Module> {
    const cacheKey = `${name}-${JSON.stringify(config)}`
    
    // 캐시 확인
    if (this.containerCache.has(cacheKey)) {
      if (this.config.debugMode) {
        console.log(`[ContainerManager] Loading from cache: ${name}`)
      }
      return this.containerCache.get(cacheKey)!
    }

    // 레지스트리에서 다운로드
    const wasmBytes = await this.downloadFromRegistry(name)
    const wasmModule = await WebAssembly.compile(wasmBytes)

    // 캐시에 저장 (크기 제한 확인)
    if (this.getCacheSize() + wasmBytes.byteLength <= this.config.cacheSize) {
      this.containerCache.set(cacheKey, wasmModule)
    }

    return wasmModule
  }

  private async downloadFromRegistry(name: string): Promise<ArrayBuffer> {
    const url = `${this.config.registry}/containers/${name}`
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), this.config.networkTimeout)
    
    try {
      const response = await fetch(url, {
        signal: controller.signal
      })

      if (!response.ok) {
        throw new Error(`Failed to download container: ${response.status} ${response.statusText}`)
      }

      return await response.arrayBuffer()

    } catch (error) {
      throw new Error(`Registry download failed for ${name}: ${getErrorMessage(error)}`)
    } finally {
      clearTimeout(timeoutId)
    }
  }

  private async createWASMInstance(
    module: WebAssembly.Module,
    runtime: WASMRuntimeType,
    config: ContainerConfig
  ): Promise<WebAssembly.Instance> {
    const runtimeImpl = this.runtimeFactory.create(runtime, config)
    return await runtimeImpl.instantiate(module)
  }

  private startMetricsCollection(container: ContainerInstance): void {
    // 주기적으로 메트릭 수집
    const intervalId = setInterval(() => {
      try {
        const metrics = container.metrics
        
        this.eventBus.emit('metrics:collected', {
          containerId: container.id,
          metrics,
          timestamp: new Date()
        })

      } catch (error) {
        console.error(`[ContainerManager] Error collecting metrics for ${container.id}:`, error)
      }
    }, 1000) // 1초마다

    // 컨테이너 종료 시 정리
    container.subscribe(() => {
      if (container.status === 'stopped') {
        clearInterval(intervalId)
      }
    })
  }

  private getCacheSize(): number {
    let totalSize = 0
    
    this.containerCache.forEach(() => {
      // WebAssembly.Module의 크기 추정 (실제로는 더 정확한 계산 필요)
      totalSize += 1024 * 1024 // 대략적인 크기
    })

    return totalSize
  }

  // 이벤트 버스 노출
  get events(): EventBus {
    return this.eventBus
  }
} 

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
