import type { 
  ContainerConfig,
  ContainerMetrics,
  IsolationPolicy 
} from '../types'
import { ContainerStatus } from '../types'
import { ContainerError } from '../errors'
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
    } catch (error) {
      this._status = ContainerStatus.ERROR
      this._metrics.errorCount++
      this.eventBus.emit('container:error', { containerId: this.id, error })
      throw error
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
      throw error
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
      throw error
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
        details: { error: error.message }
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
        reject(error)
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
} 