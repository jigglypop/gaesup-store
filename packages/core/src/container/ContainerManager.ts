import type {
  ContainerConfig,
  ContainerManagerConfig,
  ContainerID,
  StateCallback,
  Unsubscribe,
  WASMRuntimeType
} from '../types'
import { ContainerInstance } from './ContainerInstance'
import { EventBus } from '../events/EventBus'
import { RuntimeFactory } from '../runtime/RuntimeFactory'
import { ContainerNotFoundError, ContainerStartupError } from '../errors'

export class ContainerManager {
  private readonly config: Required<ContainerManagerConfig>
  private readonly containers: Map<ContainerID, ContainerInstance> = new Map()
  private readonly eventBus: EventBus
  private readonly runtimeFactory: RuntimeFactory
  private readonly containerCache: Map<string, WebAssembly.Module> = new Map()

  constructor(config: ContainerManagerConfig = {}) {
    this.config = {
      registry: config.registry || 'https://registry.gaesup.dev',
      maxContainers: config.maxContainers || 10,
      defaultRuntime: config.defaultRuntime || 'wasmtime',
      cacheSize: config.cacheSize || 100 * 1024 * 1024, // 100MB
      debugMode: config.debugMode || false,
      enableMetrics: config.enableMetrics || true,
      networkTimeout: config.networkTimeout || 5000
    }

    this.eventBus = new EventBus(this.config.debugMode)
    this.runtimeFactory = new RuntimeFactory()

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
      const wasmModule = await this.loadWASMModule(name, config)
      
      // 런타임 선택 및 인스턴스 생성
      const runtime = config.runtime || this.config.defaultRuntime
      const wasmInstance = await this.createWASMInstance(wasmModule, runtime, config)

      // 컨테이너 인스턴스 생성
      const container = new ContainerInstance(
        containerId,
        name,
        this.parseVersion(name),
        wasmModule,
        wasmInstance,
        config,
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
        config
      })

      if (this.config.debugMode) {
        console.log(`[ContainerManager] Container started successfully: ${containerId}`)
      }

      return container

    } catch (error) {
      const errorMessage = `Failed to start container ${name}: ${error.message}`
      
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
            error: error.message
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
    
    try {
      const response = await fetch(url, {
        timeout: this.config.networkTimeout
      })

      if (!response.ok) {
        throw new Error(`Failed to download container: ${response.status} ${response.statusText}`)
      }

      return await response.arrayBuffer()

    } catch (error) {
      throw new Error(`Registry download failed for ${name}: ${error.message}`)
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
    
    this.containerCache.forEach((module) => {
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