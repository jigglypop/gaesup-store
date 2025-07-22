# 9. 보안 및 격리 정책 구현 계획

## 9.1 개요

보안 및 격리 시스템은 아파트 단지의 "보안 관리소" 역할로, 각 Unit이 안전하게 격리되어 작동하면서도 필요한 상호작용은 허용하는 다층 보안 체계를 구현합니다.

### 핵심 목표
- **완전한 격리**: 각 Unit의 독립적이고 안전한 실행 환경
- **최소 권한 원칙**: 필요한 최소한의 권한만 부여
- **동적 보안 정책**: 컨텍스트에 따른 유연한 보안 규칙
- **무결성 보장**: 코드 및 데이터의 변조 방지

## 9.2 격리 계층 구조

### 9.2.1 다층 격리 모델

```typescript
enum IsolationLevel {
  // 메모리 격리
  MEMORY_ISOLATED = 'memory',      // WASM 메모리 샌드박스
  
  // 실행 격리  
  PROCESS_ISOLATED = 'process',    // 별도 워커 프로세스
  
  // 네트워크 격리
  NETWORK_ISOLATED = 'network',    // 네트워크 접근 제한
  
  // 저장소 격리
  STORAGE_ISOLATED = 'storage',    // 격리된 저장소 공간
  
  // DOM 격리
  DOM_ISOLATED = 'dom'             // Shadow DOM 캡슐화
}

interface IsolationPolicy {
  levels: IsolationLevel[]
  permissions: SecurityPermissions
  restrictions: SecurityRestrictions
  monitoring: SecurityMonitoring
}

interface SecurityPermissions {
  // 시스템 접근
  systemAccess: {
    fileSystem: boolean
    network: boolean
    localStorage: boolean
    sessionStorage: boolean
    indexedDB: boolean
    webWorkers: boolean
    sharedArrayBuffer: boolean
  }
  
  // API 접근
  apiAccess: {
    geolocation: boolean
    camera: boolean
    microphone: boolean
    notifications: boolean
    clipboard: boolean
    fullscreen: boolean
  }
  
  // 크로스 오리진
  crossOrigin: {
    allowedOrigins: string[]
    embedAllowed: boolean
    iframeAllowed: boolean
  }
  
  // 상태 접근
  stateAccess: {
    globalState: boolean
    sharedState: string[] // 허용된 상태 키 목록
    persistentState: boolean
  }
}
```

### 9.2.2 보안 컨테이너 구현

```typescript
class SecurityContainer {
  private policy: IsolationPolicy
  private sandbox: WasmSandbox
  private permissions: PermissionManager
  private monitor: SecurityMonitor
  
  constructor(unitId: string, policy: IsolationPolicy) {
    this.policy = policy
    this.sandbox = new WasmSandbox(policy)
    this.permissions = new PermissionManager(policy.permissions)
    this.monitor = new SecurityMonitor(unitId, policy.monitoring)
  }
  
  async createIsolatedEnvironment(): Promise<IsolatedEnvironment> {
    // 1. WASM 샌드박스 생성
    const wasmEnv = await this.sandbox.createEnvironment()
    
    // 2. DOM 격리 설정
    const domContext = this.createDOMContext()
    
    // 3. 네트워크 제한 적용
    const networkProxy = this.createNetworkProxy()
    
    // 4. 저장소 격리
    const storageProxy = this.createStorageProxy()
    
    // 5. API 접근 제어
    const apiProxy = this.createAPIProxy()
    
    return new IsolatedEnvironment({
      wasmEnvironment: wasmEnv,
      domContext,
      networkProxy,
      storageProxy,
      apiProxy,
      permissions: this.permissions
    })
  }
  
  private createDOMContext(): DOMContext {
    if (this.policy.levels.includes(IsolationLevel.DOM_ISOLATED)) {
      // Shadow DOM 기반 격리
      return new ShadowDOMContext({
        stylesheetIsolation: true,
        eventIsolation: true,
        globalScope: false
      })
    } else {
      // 일반 DOM 컨텍스트
      return new RegularDOMContext()
    }
  }
  
  private createNetworkProxy(): NetworkProxy {
    return new NetworkProxy({
      allowedOrigins: this.policy.permissions.crossOrigin.allowedOrigins,
      interceptFetch: true,
      interceptXHR: true,
      rateLimiting: {
        requestsPerMinute: 100,
        maxConcurrent: 10
      },
      contentFiltering: {
        blockMaliciousContent: true,
        validateResponses: true
      }
    })
  }
  
  private createStorageProxy(): StorageProxy {
    return new StorageProxy({
      namespace: this.generateNamespace(),
      allowedKeys: this.policy.permissions.stateAccess.sharedState,
      quotaLimit: 50 * 1024 * 1024, // 50MB
      encryption: true
    })
  }
}
```

## 9.3 WASM 샌드박스 보안

### 9.3.1 메모리 보호 시스템

```rust
// packages/core-rust/src/sandbox.rs
use wasm_bindgen::prelude::*;
use std::collections::HashMap;

pub struct WasmSandbox {
    memory_limit: usize,
    execution_time_limit: u64,
    allowed_imports: HashMap<String, Vec<String>>,
    security_policy: SecurityPolicy,
}

#[wasm_bindgen]
impl WasmSandbox {
    #[wasm_bindgen(constructor)]
    pub fn new(policy: &JsValue) -> Result<WasmSandbox, JsValue> {
        let security_policy: SecurityPolicy = serde_wasm_bindgen::from_value(policy.clone())?;
        
        Ok(WasmSandbox {
            memory_limit: security_policy.max_memory as usize,
            execution_time_limit: security_policy.max_execution_time,
            allowed_imports: security_policy.allowed_imports.clone(),
            security_policy,
        })
    }
    
    #[wasm_bindgen]
    pub fn validate_wasm_module(&self, wasm_bytes: &[u8]) -> Result<bool, JsValue> {
        // 1. WASM 모듈 파싱
        let module = match self.parse_wasm_module(wasm_bytes) {
            Ok(m) => m,
            Err(e) => return Err(JsValue::from_str(&format!("Invalid WASM: {}", e)))
        };
        
        // 2. 보안 검증
        self.validate_imports(&module)?;
        self.validate_exports(&module)?;
        self.validate_memory_usage(&module)?;
        
        Ok(true)
    }
    
    #[wasm_bindgen]
    pub fn create_secured_instance(
        &self,
        wasm_module: &js_sys::WebAssembly::Module
    ) -> Result<js_sys::WebAssembly::Instance, JsValue> {
        // 제한된 imports 객체 생성
        let imports = self.create_restricted_imports()?;
        
        // 메모리 제한이 있는 인스턴스 생성
        let instance = js_sys::WebAssembly::Instance::new(wasm_module, &imports)?;
        
        // 실행 시간 모니터링 설정
        self.setup_execution_monitoring(&instance)?;
        
        Ok(instance)
    }
    
    fn validate_imports(&self, module: &WasmModule) -> Result<(), String> {
        for import in &module.imports {
            let module_name = &import.module;
            let field_name = &import.field;
            
            // 허용된 import인지 확인
            if let Some(allowed_fields) = self.allowed_imports.get(module_name) {
                if !allowed_fields.contains(field_name) {
                    return Err(format!("Unauthorized import: {}::{}", module_name, field_name));
                }
            } else {
                return Err(format!("Unauthorized import module: {}", module_name));
            }
        }
        
        Ok(())
    }
    
    fn create_restricted_imports(&self) -> Result<js_sys::Object, JsValue> {
        let imports = js_sys::Object::new();
        
        // 환경 함수들 (제한된 버전)
        let env = js_sys::Object::new();
        
        // 메모리 할당 (제한된)
        let memory_allocator = js_sys::Function::new_no_args(&format!(
            "
            let allocatedMemory = 0;
            return function(size) {{
                if (allocatedMemory + size > {}) {{
                    throw new Error('Memory limit exceeded');
                }}
                allocatedMemory += size;
                return allocatedMemory - size; // 단순화된 할당
            }}
            ",
            self.memory_limit
        ));
        
        js_sys::Reflect::set(&env, &"memory_alloc".into(), &memory_allocator)?;
        
        // 안전한 로깅 함수
        let safe_log = js_sys::Function::new_with_args(
            "message",
            "console.log('[WASM]', message.substring(0, 1000));" // 로그 크기 제한
        );
        
        js_sys::Reflect::set(&env, &"log".into(), &safe_log)?;
        js_sys::Reflect::set(&imports, &"env".into(), &env)?;
        
        Ok(imports)
    }
}

#[derive(Debug, Clone)]
struct SecurityPolicy {
    max_memory: u32,
    max_execution_time: u64,
    allowed_imports: HashMap<String, Vec<String>>,
    network_access: bool,
    file_access: bool,
}
```

### 9.3.2 실행 시간 제한

```typescript
class ExecutionTimeGuard {
  private activeExecutions: Map<string, ExecutionContext> = new Map()
  private timeoutHandlers: Map<string, NodeJS.Timeout> = new Map()
  
  startExecution(
    executionId: string,
    maxTime: number,
    onTimeout: () => void
  ): void {
    const context: ExecutionContext = {
      startTime: Date.now(),
      maxTime,
      onTimeout
    }
    
    this.activeExecutions.set(executionId, context)
    
    // 타임아웃 설정
    const timeoutHandler = setTimeout(() => {
      this.handleTimeout(executionId)
    }, maxTime)
    
    this.timeoutHandlers.set(executionId, timeoutHandler)
  }
  
  endExecution(executionId: string): void {
    const timeoutHandler = this.timeoutHandlers.get(executionId)
    if (timeoutHandler) {
      clearTimeout(timeoutHandler)
      this.timeoutHandlers.delete(executionId)
    }
    
    this.activeExecutions.delete(executionId)
  }
  
  private handleTimeout(executionId: string): void {
    const context = this.activeExecutions.get(executionId)
    if (context) {
      context.onTimeout()
      this.activeExecutions.delete(executionId)
      this.timeoutHandlers.delete(executionId)
    }
  }
  
  // 실행 중인 모든 컨텍스트 모니터링
  getExecutionStats(): ExecutionStats[] {
    return Array.from(this.activeExecutions.entries()).map(([id, context]) => ({
      executionId: id,
      runTime: Date.now() - context.startTime,
      remainingTime: Math.max(0, context.maxTime - (Date.now() - context.startTime)),
      maxTime: context.maxTime
    }))
  }
}
```

## 9.4 권한 관리 시스템

### 9.4.1 동적 권한 부여

```typescript
class PermissionManager {
  private policies: Map<string, PermissionPolicy> = new Map()
  private activeGrants: Map<string, PermissionGrant> = new Map()
  private auditLog: SecurityAuditLog
  
  constructor() {
    this.auditLog = new SecurityAuditLog()
    this.setupDefaultPolicies()
  }
  
  private setupDefaultPolicies(): void {
    // 기본 보안 정책
    this.policies.set('default', {
      systemAccess: {
        fileSystem: false,
        network: false,
        localStorage: true,
        sessionStorage: true,
        indexedDB: false,
        webWorkers: false,
        sharedArrayBuffer: false
      },
      apiAccess: {
        geolocation: false,
        camera: false,
        microphone: false,
        notifications: false,
        clipboard: false,
        fullscreen: false
      },
      stateAccess: {
        globalState: false,
        sharedState: [],
        persistentState: false
      }
    })
    
    // 신뢰할 수 있는 모듈용 정책
    this.policies.set('trusted', {
      systemAccess: {
        fileSystem: false,
        network: true,
        localStorage: true,
        sessionStorage: true,
        indexedDB: true,
        webWorkers: true,
        sharedArrayBuffer: false
      },
      apiAccess: {
        geolocation: true,
        camera: false,
        microphone: false,
        notifications: true,
        clipboard: true,
        fullscreen: true
      },
      stateAccess: {
        globalState: true,
        sharedState: ['user', 'preferences', 'theme'],
        persistentState: true
      }
    })
  }
  
  async requestPermission(
    unitId: string,
    permission: string,
    context: PermissionContext
  ): Promise<PermissionResult> {
    const policy = this.getPolicyForUnit(unitId)
    
    // 1. 정책 기반 검증
    if (!this.isPermissionAllowed(permission, policy)) {
      await this.auditLog.logDenied(unitId, permission, 'policy_violation')
      return { granted: false, reason: 'policy_violation' }
    }
    
    // 2. 컨텍스트 기반 검증
    if (!this.isContextValid(permission, context)) {
      await this.auditLog.logDenied(unitId, permission, 'invalid_context')
      return { granted: false, reason: 'invalid_context' }
    }
    
    // 3. 동적 권한 부여
    const grant = await this.createPermissionGrant(unitId, permission, context)
    this.activeGrants.set(grant.id, grant)
    
    await this.auditLog.logGranted(unitId, permission, grant.id)
    
    return {
      granted: true,
      grantId: grant.id,
      expiresAt: grant.expiresAt,
      restrictions: grant.restrictions
    }
  }
  
  private async createPermissionGrant(
    unitId: string,
    permission: string,
    context: PermissionContext
  ): Promise<PermissionGrant> {
    return {
      id: this.generateGrantId(),
      unitId,
      permission,
      context,
      grantedAt: new Date(),
      expiresAt: new Date(Date.now() + this.getPermissionTTL(permission)),
      restrictions: this.calculateRestrictions(permission, context),
      usage: {
        count: 0,
        lastUsed: null
      }
    }
  }
  
  validatePermission(
    grantId: string,
    operation: string
  ): PermissionValidationResult {
    const grant = this.activeGrants.get(grantId)
    
    if (!grant) {
      return { valid: false, reason: 'grant_not_found' }
    }
    
    if (grant.expiresAt < new Date()) {
      this.activeGrants.delete(grantId)
      return { valid: false, reason: 'grant_expired' }
    }
    
    if (!this.isOperationAllowed(operation, grant)) {
      return { valid: false, reason: 'operation_not_allowed' }
    }
    
    // 사용량 업데이트
    grant.usage.count++
    grant.usage.lastUsed = new Date()
    
    return { valid: true, grant }
  }
}
```

### 9.4.2 리소스 접근 제어

```typescript
class ResourceAccessControl {
  private resourceGuards: Map<string, ResourceGuard> = new Map()
  
  constructor() {
    this.setupResourceGuards()
  }
  
  private setupResourceGuards(): void {
    // 네트워크 리소스 가드
    this.resourceGuards.set('network', new NetworkResourceGuard({
      allowedDomains: ['api.gaesup.dev', 'cdn.gaesup.dev'],
      requestLimit: {
        perMinute: 100,
        concurrent: 5
      },
      contentTypeFilter: ['application/json', 'text/plain'],
      sizeLimit: 10 * 1024 * 1024 // 10MB
    }))
    
    // 저장소 리소스 가드
    this.resourceGuards.set('storage', new StorageResourceGuard({
      quotaLimit: 50 * 1024 * 1024, // 50MB
      keyPattern: /^gaesup\..+$/,
      valueValidation: true,
      encryptionRequired: true
    }))
    
    // DOM 리소스 가드
    this.resourceGuards.set('dom', new DOMResourceGuard({
      allowedSelectors: ['.gaesup-container', '#gaesup-unit'],
      preventGlobalAccess: true,
      sanitizeHTML: true
    }))
  }
  
  async checkAccess(
    resource: string,
    operation: string,
    context: AccessContext
  ): Promise<AccessResult> {
    const guard = this.resourceGuards.get(resource)
    
    if (!guard) {
      return { allowed: false, reason: 'unknown_resource' }
    }
    
    try {
      const result = await guard.validateAccess(operation, context)
      
      if (result.allowed) {
        // 접근 로그 기록
        await this.logAccess(resource, operation, context, 'allowed')
      } else {
        // 거부 로그 기록
        await this.logAccess(resource, operation, context, 'denied', result.reason)
      }
      
      return result
    } catch (error) {
      await this.logAccess(resource, operation, context, 'error', error.message)
      return { allowed: false, reason: 'validation_error' }
    }
  }
}

class NetworkResourceGuard implements ResourceGuard {
  private config: NetworkGuardConfig
  private requestCounter: Map<string, number> = new Map()
  
  constructor(config: NetworkGuardConfig) {
    this.config = config
    this.setupRateLimiting()
  }
  
  async validateAccess(
    operation: string,
    context: AccessContext
  ): Promise<AccessResult> {
    const { url, method, headers, body } = context.networkRequest!
    
    // 1. 도메인 검증
    if (!this.isDomainAllowed(url)) {
      return { allowed: false, reason: 'domain_not_allowed' }
    }
    
    // 2. 요청 제한 검증
    if (!this.checkRateLimit(context.unitId)) {
      return { allowed: false, reason: 'rate_limit_exceeded' }
    }
    
    // 3. 컨텐츠 타입 검증
    if (!this.isContentTypeAllowed(headers)) {
      return { allowed: false, reason: 'content_type_not_allowed' }
    }
    
    // 4. 요청 크기 검증
    if (body && body.length > this.config.sizeLimit) {
      return { allowed: false, reason: 'request_too_large' }
    }
    
    return { allowed: true }
  }
  
  private isDomainAllowed(url: string): boolean {
    const hostname = new URL(url).hostname
    return this.config.allowedDomains.some(domain =>
      hostname === domain || hostname.endsWith('.' + domain)
    )
  }
  
  private checkRateLimit(unitId: string): boolean {
    const now = Date.now()
    const windowStart = now - 60000 // 1분 윈도우
    
    const key = `${unitId}:${Math.floor(now / 60000)}`
    const currentCount = this.requestCounter.get(key) || 0
    
    if (currentCount >= this.config.requestLimit.perMinute) {
      return false
    }
    
    this.requestCounter.set(key, currentCount + 1)
    return true
  }
}
```

## 9.5 보안 모니터링 및 감사

### 9.5.1 실시간 보안 모니터링

```typescript
class SecurityMonitor {
  private anomalyDetector: AnomalyDetector
  private threatDetector: ThreatDetector
  private alertManager: SecurityAlertManager
  
  constructor() {
    this.anomalyDetector = new AnomalyDetector()
    this.threatDetector = new ThreatDetector()
    this.alertManager = new SecurityAlertManager()
  }
  
  async monitorUnit(unitId: string, activity: SecurityActivity): Promise<void> {
    // 1. 이상 행동 탐지
    const anomalies = await this.anomalyDetector.detect(unitId, activity)
    
    // 2. 위협 탐지
    const threats = await this.threatDetector.analyze(activity)
    
    // 3. 보안 점수 계산
    const securityScore = this.calculateSecurityScore(anomalies, threats)
    
    // 4. 임계값 기반 대응
    if (securityScore < 70) {
      await this.handleSecurityConcern(unitId, anomalies, threats)
    }
    
    // 5. 활동 로깅
    await this.logSecurityActivity(unitId, activity, securityScore)
  }
  
  private async handleSecurityConcern(
    unitId: string,
    anomalies: Anomaly[],
    threats: Threat[]
  ): Promise<void> {
    const severity = this.calculateSeverity(anomalies, threats)
    
    switch (severity) {
      case 'low':
        await this.logWarning(unitId, anomalies, threats)
        break
        
      case 'medium':
        await this.alertManager.sendAlert({
          unitId,
          severity: 'medium',
          anomalies,
          threats,
          action: 'monitor_closely'
        })
        break
        
      case 'high':
        await this.quarantineUnit(unitId)
        await this.alertManager.sendAlert({
          unitId,
          severity: 'high',
          anomalies,
          threats,
          action: 'unit_quarantined'
        })
        break
        
      case 'critical':
        await this.emergencyShutdown(unitId)
        await this.alertManager.sendEmergencyAlert({
          unitId,
          severity: 'critical',
          anomalies,
          threats,
          action: 'emergency_shutdown'
        })
        break
    }
  }
}
```

### 9.5.2 보안 감사 로그

```typescript
class SecurityAuditLog {
  private logStorage: AuditLogStorage
  private encryptor: LogEncryptor
  
  constructor() {
    this.logStorage = new AuditLogStorage()
    this.encryptor = new LogEncryptor()
  }
  
  async logPermissionRequest(
    unitId: string,
    permission: string,
    result: 'granted' | 'denied',
    reason?: string
  ): Promise<void> {
    const entry: AuditLogEntry = {
      id: this.generateLogId(),
      timestamp: new Date(),
      type: 'permission_request',
      unitId,
      details: {
        permission,
        result,
        reason,
        userAgent: navigator.userAgent,
        ipAddress: await this.getClientIP()
      },
      severity: result === 'denied' ? 'warning' : 'info'
    }
    
    await this.storeEncryptedLog(entry)
  }
  
  async logSecurityViolation(
    unitId: string,
    violation: SecurityViolation
  ): Promise<void> {
    const entry: AuditLogEntry = {
      id: this.generateLogId(),
      timestamp: new Date(),
      type: 'security_violation',
      unitId,
      details: {
        violationType: violation.type,
        description: violation.description,
        evidence: violation.evidence,
        automaticAction: violation.response
      },
      severity: 'error'
    }
    
    await this.storeEncryptedLog(entry)
    
    // 즉시 보안팀에 알림
    await this.notifySecurityTeam(entry)
  }
  
  private async storeEncryptedLog(entry: AuditLogEntry): Promise<void> {
    const encryptedEntry = await this.encryptor.encrypt(entry)
    await this.logStorage.store(encryptedEntry)
  }
  
  async queryLogs(query: AuditLogQuery): Promise<AuditLogEntry[]> {
    const encryptedLogs = await this.logStorage.query(query)
    
    const decryptedLogs = await Promise.all(
      encryptedLogs.map(log => this.encryptor.decrypt(log))
    )
    
    return decryptedLogs
  }
}
```

---

이 보안 및 격리 시스템을 통해 **멀티테넌시 환경에서도 안전한** 모듈 실행이 가능하며, **동적 권한 관리와 실시간 모니터링**으로 보안 위협을 사전에 차단할 수 있습니다. 