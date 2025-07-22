# 4. Manifest Service와 모듈 레지스트리 통합 계획

## 4.1 개요

Manifest Service는 아파트 시스템의 "도시 계획 사무소" 역할로, 모든 Building/Unit의 메타데이터를 중앙에서 관리하고 배포 상태를 추적합니다.

### 핵심 기능
- **매니페스트 관리**: 아파트별 Building/Unit 구조 및 버전 정보
- **배포 조정**: 점진적 롤아웃, A/B 테스트, 긴급 롤백
- **버전 정책**: SemVer 호환성 검증 및 의존성 해석
- **CDN 동기화**: 모듈 배포와 매니페스트 업데이트 조율

## 4.2 매니페스트 스키마 설계

### 4.2.1 기본 구조

```typescript
interface ApartmentManifest {
  version: string                    // 매니페스트 버전
  timestamp: string                  // 마지막 업데이트 시각
  apartments: Record<string, Apartment>
  global: GlobalSettings
}

interface Apartment {
  name: string
  version: string
  description: string
  buildings: Record<string, Building>
  config: ApartmentConfig
}

interface Building {
  name: string
  category: 'header' | 'main' | 'sidebar' | 'footer'
  active_unit: string               // 현재 활성 Unit
  units: Record<string, Unit>
  routing: RoutingConfig
}

interface Unit {
  id: string
  name: string
  version: string
  framework: 'react' | 'vue' | 'svelte' | 'angular' | 'wasm'
  url: string                       // ESM 번들 URL
  wasm_url?: string                // WASM 모듈 URL
  checksum: string                 // 무결성 검증
  size: number                     // 번들 크기 (bytes)
  dependencies: string[]           // 의존성 목록
  compatibility: string            // SemVer 범위
  status: 'stable' | 'beta' | 'canary' | 'deprecated'
  rollout?: RolloutConfig          // 점진적 배포 설정
  metadata: UnitMetadata
}
```

### 4.2.2 배포 설정

```typescript
interface RolloutConfig {
  strategy: 'immediate' | 'gradual' | 'canary' | 'ab_test'
  percentage: number               // 배포 비율 (0-100)
  duration: number                 // 배포 기간 (분)
  criteria: RolloutCriteria        // 배포 대상 기준
  monitoring: MonitoringConfig     // 모니터링 설정
}

interface RolloutCriteria {
  user_segments?: string[]         // 사용자 세그먼트
  geo_regions?: string[]           // 지역 제한
  feature_flags?: string[]         // 기능 플래그
  custom_rules?: CustomRule[]      // 커스텀 규칙
}
```

## 4.3 Manifest Service 구현

### 4.3.1 Core Service

```typescript
class ManifestService {
  private manifestCache: Map<string, ApartmentManifest>
  private versionHistory: Map<string, ManifestVersion[]>
  private rolloutManager: RolloutManager
  
  constructor(
    private storage: ManifestStorage,
    private cdnClient: CDNClient,
    private eventBus: EventBus
  ) {}
  
  // 매니페스트 조회 (캐싱 + 조건부 요청)
  async getManifest(
    apartmentId: string,
    options: GetManifestOptions = {}
  ): Promise<ApartmentManifest> {
    const cacheKey = this.createCacheKey(apartmentId, options)
    
    // 캐시 확인
    if (this.manifestCache.has(cacheKey) && !options.forceRefresh) {
      const cached = this.manifestCache.get(cacheKey)!
      if (this.isCacheValid(cached, options.maxAge)) {
        return cached
      }
    }
    
    // 서버에서 조회
    const manifest = await this.fetchManifest(apartmentId, options)
    
    // 캐시 저장
    this.manifestCache.set(cacheKey, manifest)
    
    return manifest
  }
  
  // 매니페스트 업데이트
  async updateManifest(
    apartmentId: string,
    updates: ManifestUpdate
  ): Promise<void> {
    const currentManifest = await this.getManifest(apartmentId)
    const newManifest = this.applyUpdates(currentManifest, updates)
    
    // 버전 호환성 검증
    await this.validateCompatibility(newManifest)
    
    // 점진적 배포 시작
    await this.rolloutManager.startRollout(apartmentId, newManifest)
    
    // 이벤트 발행
    this.eventBus.emit('manifest.updated', {
      apartmentId,
      version: newManifest.version,
      changes: this.calculateChanges(currentManifest, newManifest)
    })
  }
  
  // Unit 버전 업데이트
  async updateUnit(
    apartmentId: string,
    buildingId: string,
    unitUpdate: UnitUpdate
  ): Promise<void> {
    const manifest = await this.getManifest(apartmentId)
    const building = manifest.apartments[apartmentId].buildings[buildingId]
    
    if (!building) {
      throw new BuildingNotFoundError(apartmentId, buildingId)
    }
    
    // 새 Unit 추가 또는 기존 Unit 업데이트
    const newUnit = await this.prepareUnit(unitUpdate)
    building.units[newUnit.id] = newUnit
    
    // CDN에 배포
    await this.deployTocdn(newUnit)
    
    // 매니페스트 업데이트
    await this.updateManifest(apartmentId, { buildings: { [buildingId]: building } })
  }
}
```

### 4.3.2 버전 관리

```typescript
class VersionManager {
  async validateCompatibility(manifest: ApartmentManifest): Promise<ValidationResult> {
    const errors: CompatibilityError[] = []
    
    for (const [apartmentId, apartment] of Object.entries(manifest.apartments)) {
      for (const [buildingId, building] of Object.entries(apartment.buildings)) {
        for (const [unitId, unit] of Object.entries(building.units)) {
          // 의존성 호환성 검증
          const depErrors = await this.validateDependencies(unit)
          errors.push(...depErrors)
          
          // API 호환성 검증
          const apiErrors = await this.validateApiCompatibility(unit)
          errors.push(...apiErrors)
        }
      }
    }
    
    return {
      valid: errors.length === 0,
      errors
    }
  }
  
  private async validateDependencies(unit: Unit): Promise<CompatibilityError[]> {
    const errors: CompatibilityError[] = []
    
    for (const dep of unit.dependencies) {
      const [name, versionRange] = dep.split('@')
      const availableVersions = await this.getAvailableVersions(name)
      
      if (!this.hasCompatibleVersion(availableVersions, versionRange)) {
        errors.push({
          type: 'dependency_not_found',
          unit: unit.id,
          dependency: dep,
          message: `호환 가능한 ${name} 버전을 찾을 수 없습니다`
        })
      }
    }
    
    return errors
  }
}
```

## 4.4 점진적 배포 관리

### 4.4.1 Rollout Manager

```typescript
class RolloutManager {
  private activeRollouts: Map<string, ActiveRollout>
  private rolloutStrategies: Map<string, RolloutStrategy>
  
  async startRollout(
    apartmentId: string,
    manifest: ApartmentManifest
  ): Promise<void> {
    const changes = this.detectChanges(apartmentId, manifest)
    
    for (const change of changes) {
      const strategy = this.selectRolloutStrategy(change)
      const rollout = await this.createRollout(change, strategy)
      
      this.activeRollouts.set(rollout.id, rollout)
      await this.executeRollout(rollout)
    }
  }
  
  private async executeRollout(rollout: ActiveRollout): Promise<void> {
    switch (rollout.strategy.type) {
      case 'immediate':
        await this.immediateRollout(rollout)
        break
        
      case 'gradual':
        await this.gradualRollout(rollout)
        break
        
      case 'canary':
        await this.canaryRollout(rollout)
        break
        
      case 'ab_test':
        await this.abTestRollout(rollout)
        break
    }
  }
  
  private async gradualRollout(rollout: ActiveRollout): Promise<void> {
    const steps = [5, 25, 50, 100] // 점진적 배포 단계
    
    for (const percentage of steps) {
      // 사용자 비율 업데이트
      await this.updateRolloutPercentage(rollout.id, percentage)
      
      // 모니터링 및 검증
      await this.monitorRollout(rollout, percentage)
      
      // 문제 발생 시 롤백
      if (await this.shouldRollback(rollout)) {
        await this.rollback(rollout)
        return
      }
      
      // 다음 단계 전 대기
      await this.delay(rollout.strategy.stepDelay)
    }
  }
}
```

### 4.4.2 사용자 분할

```typescript
class UserSegmentation {
  getUserSegment(userId: string, criteria: RolloutCriteria): boolean {
    // 해시 기반 일관된 분할
    const userHash = this.hashUserId(userId)
    
    // 지역 기반 필터링
    if (criteria.geo_regions?.length) {
      const userRegion = this.getUserRegion(userId)
      if (!criteria.geo_regions.includes(userRegion)) {
        return false
      }
    }
    
    // 사용자 세그먼트 필터링
    if (criteria.user_segments?.length) {
      const userSegments = this.getUserSegments(userId)
      if (!criteria.user_segments.some(seg => userSegments.includes(seg))) {
        return false
      }
    }
    
    // 기능 플래그 확인
    if (criteria.feature_flags?.length) {
      for (const flag of criteria.feature_flags) {
        if (!this.isFeatureFlagEnabled(userId, flag)) {
          return false
        }
      }
    }
    
    return true
  }
  
  private hashUserId(userId: string): number {
    // 일관된 해시 함수 (CRC32 등)
    let hash = 0
    for (let i = 0; i < userId.length; i++) {
      const char = userId.charCodeAt(i)
      hash = ((hash << 5) - hash) + char
      hash = hash & hash // 32bit 정수 변환
    }
    return Math.abs(hash)
  }
}
```

## 4.5 CDN 통합

### 4.5.1 배포 조율

```typescript
class CDNClient {
  async deployManifest(
    apartmentId: string,
    manifest: ApartmentManifest
  ): Promise<void> {
    // 1. 새 매니페스트 업로드
    const manifestUrl = await this.uploadManifest(apartmentId, manifest)
    
    // 2. CDN 캐시 무효화
    await this.invalidateCache([manifestUrl])
    
    // 3. 건강성 검사
    await this.verifyDeployment(manifestUrl)
    
    // 4. DNS 업데이트 (필요한 경우)
    await this.updateDNS(apartmentId, manifestUrl)
  }
  
  async deployUnit(unit: Unit): Promise<string> {
    // 병렬 업로드: JS + WASM + 소스맵
    const [jsUrl, wasmUrl, sourceMapUrl] = await Promise.all([
      this.uploadFile(unit.url, unit.content),
      unit.wasm_url ? this.uploadFile(unit.wasm_url, unit.wasmContent) : null,
      this.uploadSourceMap(unit)
    ])
    
    // 무결성 검증
    await this.verifyIntegrity(jsUrl, unit.checksum)
    
    return jsUrl
  }
  
  private async verifyDeployment(url: string): Promise<void> {
    const maxRetries = 5
    const retryDelay = 2000
    
    for (let i = 0; i < maxRetries; i++) {
      try {
        const response = await fetch(url)
        if (response.ok) {
          return
        }
      } catch (error) {
        if (i === maxRetries - 1) {
          throw new DeploymentVerificationError(url, error)
        }
        await this.delay(retryDelay * (i + 1))
      }
    }
  }
}
```

## 4.6 모니터링 및 롤백

### 4.6.1 실시간 모니터링

```typescript
class RolloutMonitor {
  async monitorRollout(rollout: ActiveRollout): Promise<MonitoringResult> {
    const metrics = await this.collectMetrics(rollout)
    const healthScore = this.calculateHealthScore(metrics)
    
    return {
      rolloutId: rollout.id,
      healthScore,
      metrics,
      recommendation: this.getRecommendation(healthScore, rollout),
      timestamp: new Date()
    }
  }
  
  private calculateHealthScore(metrics: RolloutMetrics): number {
    const weights = {
      errorRate: 0.4,
      latency: 0.3,
      throughput: 0.2,
      userFeedback: 0.1
    }
    
    const scores = {
      errorRate: Math.max(0, 100 - metrics.errorRate * 10),
      latency: Math.max(0, 100 - (metrics.avgLatency - 100) / 10),
      throughput: Math.min(100, metrics.throughput / metrics.baseline * 100),
      userFeedback: metrics.userFeedbackScore
    }
    
    return Object.entries(weights).reduce(
      (total, [key, weight]) => total + scores[key] * weight,
      0
    )
  }
  
  async shouldRollback(rollout: ActiveRollout): Promise<boolean> {
    const monitoring = await this.monitorRollout(rollout)
    
    // 임계값 기반 자동 롤백
    if (monitoring.healthScore < rollout.strategy.minHealthScore) {
      return true
    }
    
    // 에러율 급증
    if (monitoring.metrics.errorRate > rollout.strategy.maxErrorRate) {
      return true
    }
    
    // 사용자 피드백 악화
    if (monitoring.metrics.userFeedbackScore < 60) {
      return true
    }
    
    return false
  }
}
```

### 4.6.2 빠른 롤백

```typescript
class RollbackManager {
  async rollback(
    apartmentId: string,
    targetVersion?: string
  ): Promise<void> {
    // 1. 이전 버전 확인
    const versions = await this.getVersionHistory(apartmentId)
    const rollbackTarget = targetVersion 
      ? versions.find(v => v.version === targetVersion)
      : versions[1] // 바로 이전 버전
    
    if (!rollbackTarget) {
      throw new RollbackTargetNotFoundError(apartmentId, targetVersion)
    }
    
    // 2. 즉시 매니페스트 복원
    await this.manifestService.setActiveManifest(apartmentId, rollbackTarget.manifest)
    
    // 3. CDN 캐시 무효화
    await this.cdnClient.invalidateCache([
      this.getManifestUrl(apartmentId)
    ])
    
    // 4. 롤백 이벤트 발행
    this.eventBus.emit('rollback.completed', {
      apartmentId,
      fromVersion: versions[0].version,
      toVersion: rollbackTarget.version,
      duration: performance.now() - startTime
    })
  }
  
  async emergencyRollback(apartmentId: string): Promise<void> {
    // 비상 롤백: 모든 검증 우회, 최대 속도로 실행
    const lastKnownGood = await this.getLastKnownGoodVersion(apartmentId)
    await this.rollback(apartmentId, lastKnownGood.version)
  }
}
```

---

이 Manifest Service를 통해 **안전하고 효율적인** 모듈 배포 및 버전 관리를 실현할 수 있으며, 문제 발생 시 신속한 롤백으로 서비스 연속성을 보장할 수 있습니다. 