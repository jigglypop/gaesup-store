import type {
  ContainerConfig,
  ContainerMetrics,
  StateCallback,
  Unsubscribe,
  MemoryUsage,
  HealthStatus
} from '../types'
import { ContainerStatus } from '../types'
import { ContainerTimeoutError, ContainerMemoryError, ContainerSecurityError } from '../errors'
import { EventBus } from '../events/EventBus'

export class ContainerInstance {
  readonly id: string
  readonly name: string
  readonly version: string
  private readonly config: ContainerConfig
  private readonly wasmModule: WebAssembly.Module
  private readonly wasmInstance: WebAssembly.Instance
  private readonly eventBus: EventBus
  
  private _status: ContainerStatus
  private _state: any = {}
  private readonly _metrics: ContainerMetrics
  private readonly startTime: number
  private readonly stateCallbacks: Set<StateCallback> = new Set()

  constructor(
    id: string,
    name: string,
    version: string,
    wasmModule: WebAssembly.Module,
    wasmInstance: WebAssembly.Instance,
    config: ContainerConfig,
    eventBus: EventBus
  ) {
    this.id = id
    this.name = name
    this.version = version
    this.wasmModule = wasmModule
    this.wasmInstance = wasmInstance
    this.config = config
    this.eventBus = eventBus
    this.startTime = Date.now()
    
    this._status = ContainerStatus.STARTING
    this._metrics = {
      cpuUsage: 0,
      memoryUsage: {
        used: 0,
        allocated: 0,
        peak: 0,
        limit: config.maxMemory || 100 * 1024 * 1024 // 기본 100MB
      },
      uptime: 0,
      callCount: 0,
      errorCount: 0,
      lastActivity: new Date()
    }

    this.initializeInstance()
  }

  get status(): ContainerStatus {
    return this._status
  }

  get metrics(): ContainerMetrics {
    this.updateMetrics()
    return { ...this._metrics }
  }

  get state(): any {
    return this._state
  }

  private initializeInstance(): void {
    try {
      // WASM 인스턴스 초기화
      this._status = ContainerStatus.RUNNING
      this.eventBus.emit('container:start', { containerId: this.id })
      // 초기 상태 이벤트 전파
      this.eventBus.emit('state:change', {
        containerId: this.id,
        state: this._state,
        previousState: undefined
      })
    } catch (error) {
      this._status = ContainerStatus.ERROR
      this._metrics.errorCount++
      this.eventBus.emit('container:error', { containerId: this.id, error })
      throw (error instanceof Error ? error : new Error(String(error)))
    }
  }

  async call<T = any>(functionName: string, args?: any): Promise<T> {
    if (this._status !== ContainerStatus.RUNNING) {
      throw new Error(`Container ${this.id} is not running (status: ${this._status})`)
    }

    const startTime = performance.now()
    
    try {
      // CPU 시간 제한 체크
      if (this.config.maxCpuTime && this._metrics.uptime > this.config.maxCpuTime) {
        throw new ContainerTimeoutError(this.id, 'call', this.config.maxCpuTime)
      }

      // 메모리 제한 체크
      this.checkMemoryLimit()

      // 보안 체크
      this.checkSecurityPolicy(functionName)

      // WASM 함수 호출
      const wasmFunction = (this.wasmInstance.exports as any)[functionName]
      if (!wasmFunction) {
        throw new Error(`Function ${functionName} not found in container ${this.id}`)
      }

      // 함수 호출 이벤트 발행
      this.eventBus.emit('function:call', {
        containerId: this.id,
        functionName,
        args
      })

      const result = await this.executeFunction(wasmFunction, args)
      
      // 메트릭 업데이트
      this._metrics.callCount++
      this._metrics.lastActivity = new Date()

      return result
    } catch (error) {
      this._metrics.errorCount++
      this.eventBus.emit('container:error', { containerId: this.id, error })
      throw (error instanceof Error ? error : new Error(String(error)))
    } finally {
      const duration = performance.now() - startTime
      this.updateCpuMetrics(duration)
    }
  }

  async updateState(newState: any): Promise<void> {
    const previousState = this._state
    this._state = { ...this._state, ...newState }

    // 상태 변경 이벤트 발행
    this.eventBus.emit('state:change', {
      containerId: this.id,
      state: this._state,
      previousState
    })

    // 구독자들에게 알림
    this.stateCallbacks.forEach(callback => {
      try {
        callback(this._state)
      } catch (error) {
        console.error(`Error in state callback for container ${this.id}:`, error)
      }
    })
  }

  subscribe(callback: StateCallback): Unsubscribe {
    this.stateCallbacks.add(callback)
    
    return () => {
      this.stateCallbacks.delete(callback)
    }
  }

  getMemoryUsage(): MemoryUsage {
    // WebAssembly Memory에서 실제 메모리 사용량 계산
    const memory = this.wasmInstance.exports.memory as WebAssembly.Memory
    if (memory) {
      const used = memory.buffer.byteLength
      this._metrics.memoryUsage.used = used
      this._metrics.memoryUsage.allocated = used
      
      if (used > this._metrics.memoryUsage.peak) {
        this._metrics.memoryUsage.peak = used
      }

      // 메모리 경고 체크
      const usagePercent = (used / this._metrics.memoryUsage.limit) * 100
      if (usagePercent > 80) {
        this.eventBus.emit('memory:warning', {
          containerId: this.id,
          usage: this._metrics.memoryUsage
        })
      }
    }

    return { ...this._metrics.memoryUsage }
  }

  async stop(): Promise<void> {
    if (this._status === ContainerStatus.STOPPED) {
      return
    }

    this._status = ContainerStatus.STOPPING

    try {
      // 정리 작업 수행
      this.stateCallbacks.clear()
      
      // 종료 이벤트 발행
      this.eventBus.emit('container:stop', { containerId: this.id })
      
      this._status = ContainerStatus.STOPPED
    } catch (error) {
      this._status = ContainerStatus.ERROR
      throw (error instanceof Error ? error : new Error(String(error)))
    }
  }

  // 새로 추가: 컨테이너 재시작 기능
  async restart(): Promise<void> {
    console.log(`🔄 Restarting container: ${this.id}`)
    
    try {
      // 1. 현재 상태 저장
      const currentState = { ...this._state }
      
      // 2. 컨테이너 중지
      await this.stop()
      
      // 3. 잠시 대기 (리소스 정리 시간)
      await new Promise(resolve => setTimeout(resolve, 100))
      
      // 4. 컨테이너 재시작
      this._status = ContainerStatus.STARTING
      this.initializeInstance()
      
      // 5. 상태 복원
      await this.updateState(currentState)
      
      // 6. 재시작 이벤트 발행
      this.eventBus.emit('container:restart', { 
        containerId: this.id,
        restoredState: currentState 
      })
      
      console.log(`✅ Container restarted: ${this.id}`)
    } catch (error) {
      this._status = ContainerStatus.ERROR
      this.eventBus.emit('container:error', { containerId: this.id, error })
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`Failed to restart container ${this.id}: ${message}`)
    }
  }

  // 새로 추가: 핫 리로드 (상태 유지하며 코드만 새로고침)
  async hotReload(newWasmModule: WebAssembly.Module): Promise<void> {
    console.log(`🔥 Hot reloading container: ${this.id}`)
    
    try {
      const currentState = { ...this._state }
      const wasRunning = this._status === ContainerStatus.RUNNING
      
      // 새로운 WASM 모듈로 인스턴스 재생성
      const newInstance = await this.createNewInstance(newWasmModule)
      
      // 기존 인스턴스 교체
      Object.defineProperty(this, 'wasmInstance', {
        value: newInstance,
        writable: false
      })
      
      if (wasRunning) {
        this._status = ContainerStatus.RUNNING
        await this.updateState(currentState)
      }
      
      this.eventBus.emit('container:hotreload', { 
        containerId: this.id,
        preservedState: currentState 
      })
      
      console.log(`🔥 Hot reload completed: ${this.id}`)
    } catch (error) {
      this._status = ContainerStatus.ERROR
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`Hot reload failed for ${this.id}: ${message}`)
    }
  }

  // 새로 추가: 도커 컨테이너로 배포
  async deployToDocker(): Promise<string> {
    console.log(`🐳 Deploying container to Docker: ${this.id}`)
    
    try {
      const dockerConfig = {
        image: `gaesup/${this.name}:${this.version}`,
        runtime: this.getDockerRuntime(),
        environment: {
          GAESUP_CONTAINER_ID: this.id,
          GAESUP_MAX_MEMORY: `${this.config.maxMemory || 50 * 1024 * 1024}B`,
          GAESUP_ISOLATION: JSON.stringify(this.config.isolation),
          ...this.config.environment
        },
        labels: {
          'gaesup.container.id': this.id,
          'gaesup.container.name': this.name,
          'gaesup.container.version': this.version,
          'gaesup.created': new Date().toISOString()
        }
      }
      
      // 도커 API 호출 (실제로는 Docker daemon과 통신)
      const dockerContainerId = await this.callDockerAPI('create', dockerConfig)
      
      // 컨테이너 시작
      await this.callDockerAPI('start', { id: dockerContainerId })
      
      this.eventBus.emit('container:deployed', { 
        containerId: this.id,
        dockerContainerId,
        config: dockerConfig 
      })
      
      return dockerContainerId
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`Docker deployment failed for ${this.id}: ${message}`)
    }
  }

  // 새로 추가: 컨테이너 스케일링
  async scale(replicas: number): Promise<string[]> {
    console.log(`📈 Scaling container ${this.id} to ${replicas} replicas`)
    
    const replicaIds: string[] = []
    
    try {
      for (let i = 0; i < replicas; i++) {
        const replicaId = `${this.id}-replica-${i}`
        
        // 복제본 생성
        const replica = new ContainerInstance(
          replicaId,
          this.name,
          this.version,
          this.wasmModule,
          await this.createNewInstance(this.wasmModule),
          { ...this.config },
          this.eventBus
        )
        
        // 동일한 상태로 초기화
        await replica.updateState(this._state)
        
        replicaIds.push(replicaId)
      }
      
      this.eventBus.emit('container:scaled', { 
        originalId: this.id,
        replicas: replicaIds,
        count: replicas 
      })
      
      return replicaIds
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`Scaling failed for ${this.id}: ${message}`)
    }
  }

  async healthCheck(): Promise<HealthStatus> {
    const lastCheck = new Date()
    
    try {
      // 기본 헬스 체크
      const healthy = this._status === ContainerStatus.RUNNING
      
      // 추가 헬스 체크 로직
      const memoryUsage = this.getMemoryUsage()
      const memoryHealthy = memoryUsage.used < memoryUsage.limit
      
      const details = {
        status: this._status,
        uptime: this._metrics.uptime,
        memoryUsage: memoryUsage.used,
        memoryLimit: memoryUsage.limit,
        callCount: this._metrics.callCount,
        errorCount: this._metrics.errorCount
      }

      return {
        healthy: healthy && memoryHealthy,
        lastCheck,
        details
      }
    } catch (error) {
      return {
        healthy: false,
        lastCheck,
        details: { error: (error instanceof Error ? error.message : String(error)) }
      }
    }
  }

  private async executeFunction(wasmFunction: Function, args?: any): Promise<any> {
    // 타임아웃 설정
    const timeout = this.config.maxCpuTime || 5000 // 기본 5초

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new ContainerTimeoutError(this.id, 'function execution', timeout))
      }, timeout)

      try {
        const result = wasmFunction(args)
        clearTimeout(timeoutId)
        resolve(result)
      } catch (error) {
        clearTimeout(timeoutId)
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  private checkMemoryLimit(): void {
    const memoryUsage = this.getMemoryUsage()
    
    if (memoryUsage.used > memoryUsage.limit) {
      throw new ContainerMemoryError(this.id, memoryUsage.used, memoryUsage.limit)
    }
  }

  private checkSecurityPolicy(functionName: string): void {
    const { isolation } = this.config
    
    if (!isolation) return

    // 허용된 import 함수 체크
    if (this.config.allowedImports && !this.config.allowedImports.includes(functionName)) {
      throw new ContainerSecurityError(
        this.id,
        `Function ${functionName} not in allowed imports`,
        { allowedImports: this.config.allowedImports }
      )
    }

    // 파일 시스템 접근 체크
    if (!isolation.fileSystemAccess && functionName.includes('fs_')) {
      throw new ContainerSecurityError(
        this.id,
        'File system access not allowed',
        { functionName }
      )
    }

    // 네트워크 접근 체크
    if (!this.config.networkAccess && functionName.includes('net_')) {
      throw new ContainerSecurityError(
        this.id,
        'Network access not allowed',
        { functionName }
      )
    }
  }

  private updateMetrics(): void {
    this._metrics.uptime = Date.now() - this.startTime
    this.getMemoryUsage() // 메모리 메트릭 업데이트
  }

  private updateCpuMetrics(duration: number): void {
    // 간단한 CPU 사용률 계산 (실제로는 더 정교한 계산 필요)
    const currentUsage = (duration / 1000) * 100 // ms를 %로 변환
    this._metrics.cpuUsage = Math.min(100, currentUsage)

    // CPU 임계값 체크
    if (this._metrics.cpuUsage > 80) {
      this.eventBus.emit('cpu:threshold', {
        containerId: this.id,
        usage: this._metrics.cpuUsage
      })
    }
  }

  private async createNewInstance(module: WebAssembly.Module): Promise<WebAssembly.Instance> {
    // RuntimeFactory 사용해서 새 인스턴스 생성
    const runtime = this.config.runtime || 'browser'
    void runtime
    // 실제로는 RuntimeFactory 인젝션 필요
    return await WebAssembly.instantiate(module)
  }

  private getDockerRuntime(): string {
    switch (this.config.runtime) {
      case 'wasmedge': return 'io.containerd.wasmedge.v1'
      case 'wasmtime': return 'io.containerd.wasmtime.v1'
      case 'wasmer': return 'io.containerd.wasmer.v1'
      default: return 'io.containerd.wasm.v1'
    }
  }

  private async callDockerAPI(action: string, params: any): Promise<string> {
    // 실제 구현에서는 Docker Engine API 호출
    // 현재는 Mock 구현
    const response = await fetch(`/docker/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params)
    })
    
    if (!response.ok) {
      throw new Error(`Docker API ${action} failed: ${response.statusText}`)
    }
    
    const result = await response.json()
    return result.id || result.containerId
  }
} 