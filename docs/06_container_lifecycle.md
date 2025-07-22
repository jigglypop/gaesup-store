# 6. 컨테이너 라이프사이클 및 버전 관리 계획

## 6.1 개요

컨테이너 라이프사이클 관리는 아파트 "입주/이사/퇴거" 프로세스와 같이 Unit의 생성부터 소멸까지 전 과정을 안전하고 효율적으로 관리합니다.

### 핵심 목표
- **안전한 배포**: 무중단 배포 및 점진적 롤아웃
- **빠른 롤백**: 문제 발생 시 즉시 이전 버전으로 복구
- **자원 최적화**: 메모리 및 CPU 자원의 효율적 활용
- **상태 보존**: 버전 전환 시 사용자 상태 유지

## 6.2 라이프사이클 단계

### 6.2.1 컨테이너 상태 모델

```typescript
enum ContainerState {
  // 기본 상태
  CREATED = 'created',           // 생성됨
  INITIALIZING = 'initializing', // 초기화 중
  READY = 'ready',              // 준비 완료
  RUNNING = 'running',          // 실행 중
  PAUSED = 'paused',            // 일시 정지
  STOPPING = 'stopping',       // 종료 중
  STOPPED = 'stopped',          // 종료됨
  ERROR = 'error',              // 오류 상태
  
  // 배포 상태
  DEPLOYING = 'deploying',      // 배포 중
  ROLLING_OUT = 'rolling_out',  // 점진적 배포
  ROLLING_BACK = 'rolling_back' // 롤백 중
}

interface ContainerLifecycle {
  state: ContainerState
  version: string
  startTime: Date
  lastActivity: Date
  healthScore: number
  metadata: LifecycleMetadata
}
```

### 6.2.2 상태 전환 규칙

```typescript
class LifecycleStateMachine {
  private readonly validTransitions: Map<ContainerState, ContainerState[]> = new Map([
    [ContainerState.CREATED, [ContainerState.INITIALIZING, ContainerState.ERROR]],
    [ContainerState.INITIALIZING, [ContainerState.READY, ContainerState.ERROR]],
    [ContainerState.READY, [ContainerState.RUNNING, ContainerState.STOPPED]],
    [ContainerState.RUNNING, [ContainerState.PAUSED, ContainerState.STOPPING, ContainerState.ERROR]],
    [ContainerState.PAUSED, [ContainerState.RUNNING, ContainerState.STOPPING]],
    [ContainerState.STOPPING, [ContainerState.STOPPED, ContainerState.ERROR]],
    [ContainerState.STOPPED, [ContainerState.INITIALIZING]],
    [ContainerState.ERROR, [ContainerState.INITIALIZING, ContainerState.STOPPED]]
  ])
  
  canTransition(from: ContainerState, to: ContainerState): boolean {
    const allowedStates = this.validTransitions.get(from)
    return allowedStates?.includes(to) || false
  }
  
  validateTransition(from: ContainerState, to: ContainerState): void {
    if (!this.canTransition(from, to)) {
      throw new InvalidStateTransitionError(from, to)
    }
  }
}
```

## 6.3 배포 전략

### 6.3.1 Blue-Green 배포

```typescript
class BlueGreenDeployment {
  async deploy(
    apartmentId: string,
    buildingId: string,
    newVersion: UnitVersion
  ): Promise<void> {
    const deployment = await this.createDeployment(apartmentId, buildingId, newVersion)
    
    try {
      // 1. Green 환경에 새 버전 배포
      await this.deployToGreen(deployment)
      
      // 2. Green 환경 검증
      await this.validateGreenEnvironment(deployment)
      
      // 3. 트래픽 전환 (Blue → Green)
      await this.switchTraffic(deployment)
      
      // 4. Blue 환경 정리 (지연된 정리)
      this.scheduleBlueCleanup(deployment)
      
    } catch (error) {
      // 실패 시 Green 환경 정리
      await this.cleanupGreenEnvironment(deployment)
      throw error
    }
  }
  
  private async deployToGreen(deployment: Deployment): Promise<void> {
    const greenSlot = await this.allocateGreenSlot(deployment)
    
    // 새 컨테이너 인스턴스 생성
    const newContainer = await this.containerManager.createContainer({
      unitId: deployment.newVersion.unitId,
      version: deployment.newVersion.version,
      slot: greenSlot,
      isolation: 'high'
    })
    
    // 워밍업 실행
    await this.warmupContainer(newContainer)
    
    deployment.greenContainer = newContainer
  }
  
  private async validateGreenEnvironment(deployment: Deployment): Promise<void> {
    const container = deployment.greenContainer!
    
    // 헬스체크 실행
    const healthResult = await container.healthCheck()
    if (!healthResult.healthy) {
      throw new GreenEnvironmentUnhealthyError(healthResult)
    }
    
    // 통합 테스트 실행
    const testResults = await this.runIntegrationTests(container)
    if (!testResults.passed) {
      throw new IntegrationTestFailureError(testResults)
    }
    
    // 성능 테스트
    const perfResults = await this.runPerformanceTests(container)
    if (perfResults.p95Latency > deployment.performanceThresholds.maxLatency) {
      throw new PerformanceRegressionError(perfResults)
    }
  }
  
  private async switchTraffic(deployment: Deployment): Promise<void> {
    const switchStrategy = deployment.config.switchStrategy || 'immediate'
    
    switch (switchStrategy) {
      case 'immediate':
        await this.immediateSwitch(deployment)
        break
        
      case 'gradual':
        await this.gradualSwitch(deployment)
        break
        
      case 'canary':
        await this.canarySwitch(deployment)
        break
    }
  }
}
```

### 6.3.2 카나리 배포

```typescript
class CanaryDeployment {
  async deployCanary(
    deployment: Deployment,
    canaryConfig: CanaryConfig
  ): Promise<void> {
    const steps = canaryConfig.steps || [5, 25, 50, 100]
    
    for (const percentage of steps) {
      // 트래픽 비율 업데이트
      await this.updateTrafficSplit(deployment, percentage)
      
      // 모니터링 대기
      await this.monitorCanary(deployment, canaryConfig.monitorDuration)
      
      // 메트릭 평가
      const metrics = await this.evaluateMetrics(deployment)
      if (!this.meetsSuccessCriteria(metrics, canaryConfig.successCriteria)) {
        await this.rollbackCanary(deployment)
        throw new CanaryFailureError(metrics)
      }
      
      // 다음 단계 전 대기
      if (percentage < 100) {
        await this.delay(canaryConfig.stepDelay)
      }
    }
  }
  
  private async evaluateMetrics(deployment: Deployment): Promise<CanaryMetrics> {
    const timeWindow = 5 * 60 * 1000 // 5분
    const endTime = Date.now()
    const startTime = endTime - timeWindow
    
    const [errorRate, latency, throughput] = await Promise.all([
      this.metricsCollector.getErrorRate(deployment.unitId, startTime, endTime),
      this.metricsCollector.getLatencyPercentiles(deployment.unitId, startTime, endTime),
      this.metricsCollector.getThroughput(deployment.unitId, startTime, endTime)
    ])
    
    return {
      errorRate,
      latency,
      throughput,
      timestamp: Date.now()
    }
  }
  
  private meetsSuccessCriteria(
    metrics: CanaryMetrics,
    criteria: SuccessCriteria
  ): boolean {
    if (metrics.errorRate > criteria.maxErrorRate) {
      return false
    }
    
    if (metrics.latency.p95 > criteria.maxLatencyP95) {
      return false
    }
    
    if (metrics.throughput < criteria.minThroughput) {
      return false
    }
    
    return true
  }
}
```

## 6.4 버전 관리

### 6.4.1 의미적 버전 관리

```typescript
class VersionManager {
  validateVersionBump(
    currentVersion: string,
    newVersion: string,
    changes: ChangeSet
  ): ValidationResult {
    const current = semver.parse(currentVersion)
    const next = semver.parse(newVersion)
    
    if (!current || !next) {
      return { valid: false, error: 'Invalid version format' }
    }
    
    // 변경 사항 분석
    const requiredBump = this.analyzeRequiredBump(changes)
    const actualBump = this.calculateBump(current, next)
    
    if (actualBump < requiredBump) {
      return {
        valid: false,
        error: `Version bump too small. Required: ${BumpType[requiredBump]}, Actual: ${BumpType[actualBump]}`
      }
    }
    
    return { valid: true }
  }
  
  private analyzeRequiredBump(changes: ChangeSet): BumpType {
    if (changes.breaking.length > 0) {
      return BumpType.Major
    }
    
    if (changes.features.length > 0) {
      return BumpType.Minor
    }
    
    if (changes.fixes.length > 0 || changes.internal.length > 0) {
      return BumpType.Patch
    }
    
    return BumpType.None
  }
  
  async createVersionTag(
    unitId: string,
    version: string,
    metadata: VersionMetadata
  ): Promise<void> {
    const versionTag: VersionTag = {
      unitId,
      version,
      timestamp: new Date(),
      metadata,
      checksum: await this.calculateChecksum(unitId, version),
      dependencies: await this.resolveDependencies(unitId, version)
    }
    
    await this.versionStorage.saveVersionTag(versionTag)
    
    // 이벤트 발행
    this.eventBus.emit('version.created', versionTag)
  }
}
```

### 6.4.2 의존성 해석

```typescript
class DependencyResolver {
  async resolveDependencies(
    unitId: string,
    version: string
  ): Promise<ResolvedDependencies> {
    const unit = await this.unitRegistry.getUnit(unitId, version)
    const dependencies: ResolvedDependency[] = []
    
    for (const dep of unit.dependencies) {
      const resolved = await this.resolveDependency(dep)
      dependencies.push(resolved)
      
      // 순환 의존성 검사
      if (this.hasCircularDependency(unitId, resolved)) {
        throw new CircularDependencyError(unitId, resolved.unitId)
      }
    }
    
    return {
      unitId,
      version,
      dependencies,
      resolvedAt: new Date()
    }
  }
  
  private async resolveDependency(
    dep: DependencySpec
  ): Promise<ResolvedDependency> {
    const [name, versionRange] = dep.split('@')
    
    // 사용 가능한 버전 조회
    const availableVersions = await this.unitRegistry.getVersions(name)
    
    // SemVer 범위에 맞는 최신 버전 선택
    const bestMatch = semver.maxSatisfying(availableVersions, versionRange)
    
    if (!bestMatch) {
      throw new DependencyResolutionError(name, versionRange, availableVersions)
    }
    
    return {
      unitId: name,
      version: bestMatch,
      versionRange,
      resolved: true
    }
  }
}
```

## 6.5 자원 관리

### 6.5.1 리소스 할당 및 제한

```typescript
class ResourceManager {
  private resourceLimits: Map<string, ResourceLimit> = new Map()
  private activeAllocations: Map<string, ResourceAllocation> = new Map()
  
  async allocateResources(
    containerId: string,
    requirements: ResourceRequirements
  ): Promise<ResourceAllocation> {
    // 리소스 가용성 확인
    if (!await this.checkResourceAvailability(requirements)) {
      throw new InsufficientResourcesError(requirements)
    }
    
    // 리소스 할당
    const allocation: ResourceAllocation = {
      containerId,
      memory: await this.allocateMemory(requirements.memory),
      cpu: await this.allocateCPU(requirements.cpu),
      storage: await this.allocateStorage(requirements.storage),
      network: await this.allocateNetworkBandwidth(requirements.network)
    }
    
    this.activeAllocations.set(containerId, allocation)
    
    // 리소스 모니터링 시작
    this.startResourceMonitoring(containerId, allocation)
    
    return allocation
  }
  
  async deallocateResources(containerId: string): Promise<void> {
    const allocation = this.activeAllocations.get(containerId)
    if (!allocation) return
    
    // 리소스 해제
    await Promise.all([
      this.deallocateMemory(allocation.memory),
      this.deallocateCPU(allocation.cpu),
      this.deallocateStorage(allocation.storage),
      this.deallocateNetworkBandwidth(allocation.network)
    ])
    
    this.activeAllocations.delete(containerId)
  }
  
  private startResourceMonitoring(
    containerId: string,
    allocation: ResourceAllocation
  ): void {
    const monitor = new ResourceMonitor(containerId, allocation)
    
    monitor.on('limit_exceeded', async (resource, usage) => {
      await this.handleResourceLimitExceeded(containerId, resource, usage)
    })
    
    monitor.on('memory_pressure', async () => {
      await this.handleMemoryPressure(containerId)
    })
    
    monitor.start()
  }
}
```

### 6.5.2 가비지 컬렉션

```typescript
class ContainerGarbageCollector {
  private cleanupScheduler: CleanupScheduler
  
  constructor() {
    this.cleanupScheduler = new CleanupScheduler()
    this.setupCleanupTasks()
  }
  
  private setupCleanupTasks(): void {
    // 주기적 정리 작업
    this.cleanupScheduler.schedule('unused_containers', {
      interval: 30 * 60 * 1000, // 30분마다
      task: () => this.cleanupUnusedContainers()
    })
    
    this.cleanupScheduler.schedule('memory_optimization', {
      interval: 5 * 60 * 1000, // 5분마다
      task: () => this.optimizeMemoryUsage()
    })
    
    this.cleanupScheduler.schedule('cache_eviction', {
      interval: 60 * 60 * 1000, // 1시간마다
      task: () => this.evictStaleCache()
    })
  }
  
  private async cleanupUnusedContainers(): Promise<void> {
    const unusedContainers = await this.findUnusedContainers()
    
    for (const container of unusedContainers) {
      const idleTime = Date.now() - container.lastActivity.getTime()
      const threshold = this.getIdleThreshold(container)
      
      if (idleTime > threshold) {
        await this.safelyRemoveContainer(container)
      }
    }
  }
  
  private async safelyRemoveContainer(container: ContainerInstance): Promise<void> {
    try {
      // 1. 상태 백업 (필요한 경우)
      if (container.hasImportantState()) {
        await this.backupContainerState(container)
      }
      
      // 2. graceful shutdown
      await container.gracefulShutdown(30000) // 30초 타임아웃
      
      // 3. 리소스 해제
      await this.resourceManager.deallocateResources(container.id)
      
      // 4. 메타데이터 정리
      await this.cleanupMetadata(container.id)
      
    } catch (error) {
      console.error(`Failed to cleanup container ${container.id}:`, error)
    }
  }
}
```

## 6.6 장애 복구

### 6.6.1 자동 복구 시스템

```typescript
class AutoRecoverySystem {
  private recoveryStrategies: Map<string, RecoveryStrategy> = new Map()
  
  constructor() {
    this.setupRecoveryStrategies()
  }
  
  private setupRecoveryStrategies(): void {
    this.recoveryStrategies.set('container_crash', {
      detect: (event) => event.type === 'container_crashed',
      recover: async (event) => {
        const container = event.container
        
        // 1. crash dump 수집
        await this.collectCrashDump(container)
        
        // 2. 새 인스턴스 시작
        const newContainer = await this.startNewInstance(container.config)
        
        // 3. 상태 복원
        await this.restoreState(newContainer, container.lastKnownState)
        
        // 4. 트래픽 전환
        await this.switchTraffic(container.id, newContainer.id)
      },
      maxRetries: 3,
      retryDelay: 5000
    })
    
    this.recoveryStrategies.set('memory_leak', {
      detect: (event) => event.type === 'memory_usage_high' && event.trend === 'increasing',
      recover: async (event) => {
        const container = event.container
        
        // 1. 메모리 덤프 생성
        await this.createMemoryDump(container)
        
        // 2. 컨테이너 재시작
        await this.restartContainer(container)
      },
      maxRetries: 1,
      retryDelay: 0
    })
  }
  
  async handleFailure(event: FailureEvent): Promise<void> {
    for (const [name, strategy] of this.recoveryStrategies) {
      if (strategy.detect(event)) {
        await this.executeRecovery(strategy, event)
        break
      }
    }
  }
  
  private async executeRecovery(
    strategy: RecoveryStrategy,
    event: FailureEvent
  ): Promise<void> {
    let attempt = 0
    
    while (attempt <= strategy.maxRetries) {
      try {
        await strategy.recover(event)
        
        // 복구 성공 이벤트 발행
        this.eventBus.emit('recovery.success', {
          strategy: strategy.name,
          event,
          attempt
        })
        
        return
        
      } catch (error) {
        attempt++
        
        if (attempt > strategy.maxRetries) {
          // 복구 실패 - 에스컬레이션
          await this.escalateFailure(event, error)
          throw error
        }
        
        // 재시도 전 대기
        await this.delay(strategy.retryDelay * attempt)
      }
    }
  }
}
```

---

이 라이프사이클 관리 시스템을 통해 **안전하고 효율적인** 컨테이너 운영이 가능하며, 장애 상황에서도 **신속한 복구**를 보장할 수 있습니다. 