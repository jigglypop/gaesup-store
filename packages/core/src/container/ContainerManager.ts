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

    // 항상 한 번만 초기화 로그
    console.log('[ContainerManager] Initialized with config:', this.config)
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
      // Mock 모드에서는 네트워크 로드/컴파일을 건너뛴다
      const isMock = config.environment?.GAESUP_MOCK === 'true'
      const wasmModule: WebAssembly.Module = isMock
        ? ({} as unknown as WebAssembly.Module)
        : await this.loadWASMModule(name, config)
      
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
      const message = error instanceof Error ? error.message : String(error)
      const errorMessage = `Failed to start container ${name}: ${message}`
      
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
      throw (error instanceof Error ? error : new Error(String(error)))
    }
  }

  // 새로 추가: 컨테이너 재시작
  async restart(containerId: ContainerID): Promise<ContainerInstance> {
    const container = this.containers.get(containerId)
    
    if (!container) {
      throw new ContainerNotFoundError(containerId)
    }

    try {
      if (this.config.debugMode) {
        console.log(`[ContainerManager] Restarting container: ${containerId}`)
      }

      await container.restart()

      this.eventBus.emit('manager:container_restarted', {
        containerId,
        name: container.name,
        timestamp: new Date()
      })

      return container
    } catch (error) {
      console.error(`[ContainerManager] Error restarting container ${containerId}:`, error)
      throw (error instanceof Error ? error : new Error(String(error)))
    }
  }

  // 새로 추가: 핫 리로드 (개발 모드용)
  async hotReload(containerId: ContainerID): Promise<ContainerInstance> {
    const container = this.containers.get(containerId)
    
    if (!container) {
      throw new ContainerNotFoundError(containerId)
    }

    try {
      if (this.config.debugMode) {
        console.log(`[ContainerManager] Hot reloading container: ${containerId}`)
      }

      // 최신 WASM 모듈 다운로드
      const newWasmModule = await this.loadWASMModule(container.name, container['config'])
      
      await container.hotReload(newWasmModule)

      this.eventBus.emit('manager:container_hotreloaded', {
        containerId,
        name: container.name,
        timestamp: new Date()
      })

      if (this.config.debugMode) {
        console.log(`[ContainerManager] Hot reload completed: ${containerId}`)
      }

      return container
    } catch (error) {
      console.error(`[ContainerManager] Error hot reloading container ${containerId}:`, error)
      throw (error instanceof Error ? error : new Error(String(error)))
    }
  }

  // 새로 추가: 도커에 배포
  async deployToDocker(containerId: ContainerID): Promise<string> {
    const container = this.containers.get(containerId)
    
    if (!container) {
      throw new ContainerNotFoundError(containerId)
    }

    try {
      if (this.config.debugMode) {
        console.log(`[ContainerManager] Deploying to Docker: ${containerId}`)
      }

      const dockerContainerId = await container.deployToDocker()

      this.eventBus.emit('manager:container_deployed', {
        containerId,
        dockerContainerId,
        name: container.name,
        timestamp: new Date()
      })

      return dockerContainerId
    } catch (error) {
      console.error(`[ContainerManager] Error deploying container ${containerId}:`, error)
      throw (error instanceof Error ? error : new Error(String(error)))
    }
  }

  // 새로 추가: 컨테이너 스케일링
  async scale(containerId: ContainerID, replicas: number): Promise<string[]> {
    const container = this.containers.get(containerId)
    
    if (!container) {
      throw new ContainerNotFoundError(containerId)
    }

    if (replicas < 1) {
      throw new Error('Replicas must be at least 1')
    }

    if (this.containers.size + replicas > this.config.maxContainers) {
      throw new Error(`Scaling would exceed maximum containers (${this.config.maxContainers})`)
    }

    try {
      if (this.config.debugMode) {
        console.log(`[ContainerManager] Scaling container ${containerId} to ${replicas} replicas`)
      }

      const replicaIds = await container.scale(replicas)

      // 복제본들을 매니저에 등록 (실제로는 더 복잡한 구현 필요)
      for (const replicaId of replicaIds) {
        // 여기서는 간단히 이벤트만 발행
        this.eventBus.emit('manager:replica_created', {
          originalId: containerId,
          replicaId,
          timestamp: new Date()
        })
      }

      this.eventBus.emit('manager:container_scaled', {
        containerId,
        replicas: replicaIds,
        count: replicas,
        timestamp: new Date()
      })

      return replicaIds
    } catch (error) {
      console.error(`[ContainerManager] Error scaling container ${containerId}:`, error)
      throw (error instanceof Error ? error : new Error(String(error)))
    }
  }

  // 새로 추가: 모든 컨테이너 재시작
  async restartAll(): Promise<void> {
    if (this.config.debugMode) {
      console.log(`[ContainerManager] Restarting all ${this.containers.size} containers`)
    }

    const restartPromises = Array.from(this.containers.keys()).map(
      containerId => this.restart(containerId).catch(error => {
        console.error(`Failed to restart container ${containerId}:`, error)
        return null
      })
    )

    const results = await Promise.allSettled(restartPromises)
    const successCount = results.filter(r => r.status === 'fulfilled').length
    const failCount = results.length - successCount

    this.eventBus.emit('manager:bulk_restart_completed', {
      total: results.length,
      success: successCount,
      failed: failCount,
      timestamp: new Date()
    })

    if (this.config.debugMode) {
      console.log(`[ContainerManager] Restart completed: ${successCount} success, ${failCount} failed`)
    }
  }

  // 새로 추가: 도커 컴포즈 생성
  generateDockerCompose(): string {
    const services: any = {}
    
    this.containers.forEach((container, id) => {
      services[id] = {
        image: `gaesup/${container.name}:${container.version}`,
        runtime: container['getDockerRuntime'] ? container['getDockerRuntime']() : 'io.containerd.wasm.v1',
        platform: 'wasi/wasm',
        environment: {
          GAESUP_CONTAINER_ID: id,
          GAESUP_REGISTRY: this.config.registry,
          ...container['config']?.environment
        },
        networks: ['gaesup-network'],
        restart: 'unless-stopped',
        labels: {
          'gaesup.managed': 'true',
          'gaesup.container.id': id,
          'gaesup.container.name': container.name
        }
      }
    })

    const compose = {
      version: '3.8',
      services,
      networks: {
        'gaesup-network': {
          driver: 'bridge'
        }
      }
    }

    return `# Generated by Gaesup-State ContainerManager
# ${new Date().toISOString()}

${require('yaml').stringify(compose)}`
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
            error: (error instanceof Error ? error.message : String(error))
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
      const controller = new AbortController()
      const id = setTimeout(() => controller.abort(), this.config.networkTimeout)
      const response = await fetch(url, { signal: controller.signal })
      clearTimeout(id)

      if (!response.ok) {
        throw new Error(`Failed to download container: ${response.status} ${response.statusText}`)
      }

      return await response.arrayBuffer()

    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`Registry download failed for ${name}: ${message}`)
    }
  }

  private async createWASMInstance(
    module: WebAssembly.Module,
    runtime: WASMRuntimeType,
    config: ContainerConfig
  ): Promise<WebAssembly.Instance> {
    // 개발/데모용 모드: 실제 WASM 없이 JS 모의 인스턴스 사용
    if (config.environment && config.environment.GAESUP_MOCK === 'true') {
      return this.createMockInstance(config)
    }
    const runtimeImpl = this.runtimeFactory.create(runtime, config)
    return await runtimeImpl.instantiate(module)
  }

  // JS 기반 모의 WASM 인스턴스 (데모/개발 전용)
  private createMockInstance(config: ContainerConfig): WebAssembly.Instance {
    // 컨테이너별 기본 상태
    let todoState: any[] = []
    let counterState: { count: number; lastUpdated: string; totalOperations: number } = {
      count: 0,
      lastUpdated: new Date().toISOString(),
      totalOperations: 0
    }

    const exports: Record<string, any> = {
      // Todo 컨테이너 함수들
      addTodo: ({ title, completed = false }: { title: string; completed?: boolean }) => {
        const id = Date.now()
        const item = { id, title, completed, createdAt: new Date().toISOString() }
        todoState = [...todoState, item]
        return [...todoState]
      },
      toggleTodo: ({ id }: { id: number }) => {
        todoState = todoState.map(t => (t.id === id ? { ...t, completed: !t.completed } : t))
        return [...todoState]
      },
      removeTodo: ({ id }: { id: number }) => {
        todoState = todoState.filter(t => t.id !== id)
        return [...todoState]
      },
      clearCompleted: () => {
        todoState = todoState.filter(t => !t.completed)
        return [...todoState]
      },

      // Counter 컨테이너 함수들
      increment: () => {
        counterState = {
          count: counterState.count + 1,
          totalOperations: counterState.totalOperations + 1,
          lastUpdated: new Date().toISOString()
        }
        return { ...counterState }
      },
      decrement: () => {
        counterState = {
          count: counterState.count - 1,
          totalOperations: counterState.totalOperations + 1,
          lastUpdated: new Date().toISOString()
        }
        return { ...counterState }
      },
      reset: () => {
        counterState = {
          count: 0,
          totalOperations: counterState.totalOperations + 1,
          lastUpdated: new Date().toISOString()
        }
        return { ...counterState }
      },
      addAmount: ({ amount }: { amount: number }) => {
        counterState = {
          count: counterState.count + (amount || 0),
          totalOperations: counterState.totalOperations + 1,
          lastUpdated: new Date().toISOString()
        }
        return { ...counterState }
      },

      // 필수 메모리
      memory: new WebAssembly.Memory({ initial: 1 })
    }

    const instance = { exports } as unknown as WebAssembly.Instance
    return instance
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
    
    this.containerCache.forEach((_module) => {
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