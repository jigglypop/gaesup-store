use wasm_bindgen::prelude::*;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use chrono::{DateTime, Utc};
use sha2::{Sha256, Digest};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SecurityPolicy {
    pub allow_network: bool,
    pub allow_filesystem: bool,
    pub allow_environment: bool,
    pub allowed_functions: HashSet<String>,
    pub blocked_functions: HashSet<String>,
    pub max_memory: u32,
    pub max_execution_time: u32, // milliseconds
    pub require_signature: bool,
    pub trusted_origins: HashSet<String>,
    pub isolation_level: IsolationLevel,
}

impl SecurityPolicy {
    pub fn default() -> Self {
        let mut allowed_functions = HashSet::new();
        allowed_functions.insert("increment".to_string());
        allowed_functions.insert("decrement".to_string());
        allowed_functions.insert("reset".to_string());
        allowed_functions.insert("get_state".to_string());

        SecurityPolicy {
            allow_network: false,
            allow_filesystem: false,
            allow_environment: false,
            allowed_functions,
            blocked_functions: HashSet::new(),
            max_memory: 64 * 1024 * 1024, // 64MB
            max_execution_time: 5000, // 5초
            require_signature: false,
            trusted_origins: HashSet::new(),
            isolation_level: IsolationLevel::Medium,
        }
    }

    pub fn strict() -> Self {
        SecurityPolicy {
            allow_network: false,
            allow_filesystem: false,
            allow_environment: false,
            allowed_functions: HashSet::new(),
            blocked_functions: HashSet::new(),
            max_memory: 16 * 1024 * 1024, // 16MB
            max_execution_time: 1000, // 1초
            require_signature: true,
            trusted_origins: HashSet::new(),
            isolation_level: IsolationLevel::High,
        }
    }

    pub fn permissive() -> Self {
        SecurityPolicy {
            allow_network: true,
            allow_filesystem: true,
            allow_environment: true,
            allowed_functions: HashSet::new(), // 빈 set = 모든 함수 허용
            blocked_functions: HashSet::new(),
            max_memory: 256 * 1024 * 1024, // 256MB
            max_execution_time: 30000, // 30초
            require_signature: false,
            trusted_origins: HashSet::new(),
            isolation_level: IsolationLevel::Low,
        }
    }

    pub fn is_function_allowed(&self, function_name: &str) -> bool {
        // blocked_functions에 있으면 거부
        if self.blocked_functions.contains(function_name) {
            return false;
        }

        // allowed_functions가 비어있으면 모든 함수 허용 (permissive mode)
        if self.allowed_functions.is_empty() {
            return true;
        }

        // allowed_functions에 있으면 허용
        self.allowed_functions.contains(function_name)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum IsolationLevel {
    Low,    // 기본 보안만 적용
    Medium, // 리소스 제한 + 함수 제한
    High,   // 강력한 격리 + 서명 검증
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SecurityEvent {
    pub event_type: SecurityEventType,
    pub container_id: String,
    pub description: String,
    pub severity: SecuritySeverity,
    pub timestamp: DateTime<Utc>,
    pub metadata: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum SecurityEventType {
    UnauthorizedFunctionCall,
    MemoryLimitExceeded,
    ExecutionTimeExceeded,
    InvalidSignature,
    SuspiciousActivity,
    PolicyViolation,
    AccessDenied,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum SecuritySeverity {
    Low,
    Medium,
    High,
    Critical,
}

#[derive(Debug)]
pub struct SecurityContext {
    container_id: String,
    policy: SecurityPolicy,
    execution_start: Option<DateTime<Utc>>,
    memory_allocated: u32,
    function_calls: u32,
    security_events: Vec<SecurityEvent>,
    signature_verified: bool,
}

impl SecurityContext {
    pub fn new(container_id: String, policy: SecurityPolicy) -> Self {
        let requires_signature = policy.require_signature;
        SecurityContext {
            container_id,
            policy,
            execution_start: None,
            memory_allocated: 0,
            function_calls: 0,
            security_events: Vec::new(),
            signature_verified: !requires_signature, // 서명 불필요시 true
        }
    }

    pub fn start_execution(&mut self) {
        self.execution_start = Some(Utc::now());
    }

    pub fn check_execution_time(&self) -> Result<(), SecurityViolation> {
        if let Some(start_time) = self.execution_start {
            let elapsed = Utc::now() - start_time;
            let elapsed_ms = elapsed.num_milliseconds() as u32;

            if elapsed_ms > self.policy.max_execution_time {
                return Err(SecurityViolation {
                    violation_type: SecurityViolationType::ExecutionTimeExceeded,
                    description: format!("실행 시간 초과: {}ms > {}ms", 
                        elapsed_ms, self.policy.max_execution_time),
                    severity: SecuritySeverity::High,
                });
            }
        }
        Ok(())
    }

    pub fn check_memory_limit(&self, requested_memory: u32) -> Result<(), SecurityViolation> {
        let total_memory = self.memory_allocated + requested_memory;
        
        if total_memory > self.policy.max_memory {
            return Err(SecurityViolation {
                violation_type: SecurityViolationType::MemoryLimitExceeded,
                description: format!("메모리 한계 초과: {}MB > {}MB", 
                    total_memory / (1024 * 1024), 
                    self.policy.max_memory / (1024 * 1024)),
                severity: SecuritySeverity::High,
            });
        }
        Ok(())
    }

    pub fn allocate_memory(&mut self, size: u32) -> Result<(), SecurityViolation> {
        self.check_memory_limit(size)?;
        self.memory_allocated += size;
        Ok(())
    }

    pub fn deallocate_memory(&mut self, size: u32) {
        self.memory_allocated = self.memory_allocated.saturating_sub(size);
    }

    pub fn check_function_access(&self, function_name: &str) -> Result<(), SecurityViolation> {
        if !self.policy.is_function_allowed(function_name) {
            return Err(SecurityViolation {
                violation_type: SecurityViolationType::UnauthorizedFunctionCall,
                description: format!("허용되지 않은 함수 호출: {}", function_name),
                severity: SecuritySeverity::Medium,
            });
        }
        Ok(())
    }

    pub fn record_function_call(&mut self, function_name: &str) {
        self.function_calls += 1;
        
        // 비정상적인 함수 호출 패턴 감지
        if self.function_calls > 1000 {
            let event = SecurityEvent {
                event_type: SecurityEventType::SuspiciousActivity,
                container_id: self.container_id.clone(),
                description: format!("비정상적으로 많은 함수 호출: {} ({}번째)", 
                    function_name, self.function_calls),
                severity: SecuritySeverity::Medium,
                timestamp: Utc::now(),
                metadata: HashMap::new(),
            };
            self.security_events.push(event);
        }
    }

    pub fn verify_signature(&mut self, signature: &str, data: &[u8]) -> Result<(), SecurityViolation> {
        if !self.policy.require_signature {
            return Ok(());
        }

        // 간단한 해시 기반 서명 검증 (실제로는 더 복잡한 암호화 방식 사용)
        let mut hasher = Sha256::new();
        hasher.update(data);
        let computed_hash = format!("{:x}", hasher.finalize());

        if signature != computed_hash {
            self.signature_verified = false;
            return Err(SecurityViolation {
                violation_type: SecurityViolationType::InvalidSignature,
                description: "서명 검증 실패".to_string(),
                severity: SecuritySeverity::Critical,
            });
        }

        self.signature_verified = true;
        Ok(())
    }

    pub fn is_trusted(&self) -> bool {
        self.signature_verified || !self.policy.require_signature
    }

    pub fn get_security_events(&self) -> &Vec<SecurityEvent> {
        &self.security_events
    }

    pub fn add_security_event(&mut self, event: SecurityEvent) {
        self.security_events.push(event);
    }
}

#[derive(Debug, Clone)]
pub struct SecurityViolation {
    pub violation_type: SecurityViolationType,
    pub description: String,
    pub severity: SecuritySeverity,
}

#[derive(Debug, Clone)]
pub enum SecurityViolationType {
    UnauthorizedFunctionCall,
    MemoryLimitExceeded,
    ExecutionTimeExceeded,
    InvalidSignature,
    PolicyViolation,
    AccessDenied,
}

#[derive(Debug)]
pub struct SecurityManager {
    container_contexts: HashMap<String, SecurityContext>,
    global_policy: SecurityPolicy,
    security_events: Vec<SecurityEvent>,
    threat_detection_enabled: bool,
    audit_log: Vec<AuditEntry>,
}

impl SecurityManager {
    pub fn new() -> Self {
        SecurityManager {
            container_contexts: HashMap::new(),
            global_policy: SecurityPolicy::default(),
            security_events: Vec::new(),
            threat_detection_enabled: true,
            audit_log: Vec::new(),
        }
    }

    pub fn apply_policy(&mut self, container_id: &str, policy: SecurityPolicy) -> Result<(), JsValue> {
        log::info!("🔒 보안 정책 적용: {} (격리 레벨: {:?})", container_id, policy.isolation_level);

        let context = SecurityContext::new(container_id.to_string(), policy);
        self.container_contexts.insert(container_id.to_string(), context);

        // 감사 로그 기록
        let audit_entry = AuditEntry {
            action: AuditAction::PolicyApplied,
            container_id: container_id.to_string(),
            timestamp: Utc::now(),
            details: "보안 정책 적용".to_string(),
        };
        self.audit_log.push(audit_entry);

        Ok(())
    }

    pub fn validate_function_call(&mut self, container_id: &str, function_name: &str) -> Result<(), JsValue> {
        if let Some(context) = self.container_contexts.get_mut(container_id) {
            // 함수 접근 권한 확인
            if let Err(violation) = context.check_function_access(function_name) {
                self.handle_security_violation(container_id, violation)?;
                return Err(JsValue::from_str("Function call denied"));
            }

            // 실행 시간 확인
            if let Err(violation) = context.check_execution_time() {
                self.handle_security_violation(container_id, violation)?;
                return Err(JsValue::from_str("Execution time exceeded"));
            }

            // 함수 호출 기록
            context.record_function_call(function_name);

            // 감사 로그 기록
            let audit_entry = AuditEntry {
                action: AuditAction::FunctionCalled,
                container_id: container_id.to_string(),
                timestamp: Utc::now(),
                details: format!("함수 호출: {}", function_name),
            };
            self.audit_log.push(audit_entry);

            log::debug!("🔐 함수 호출 승인: {}::{}", container_id, function_name);
            return Ok(());
        }

        Err(JsValue::from_str("Container security context not found"))
    }

    pub fn validate_memory_allocation(&mut self, container_id: &str, size: u32) -> Result<(), JsValue> {
        if let Some(context) = self.container_contexts.get_mut(container_id) {
            if let Err(violation) = context.allocate_memory(size) {
                self.handle_security_violation(container_id, violation)?;
                return Err(JsValue::from_str("Memory allocation denied"));
            }

            log::debug!("💾 메모리 할당 승인: {} ({}KB)", container_id, size / 1024);
            return Ok(());
        }

        Err(JsValue::from_str("Container security context not found"))
    }

    pub fn deallocate_memory(&mut self, container_id: &str, size: u32) {
        if let Some(context) = self.container_contexts.get_mut(container_id) {
            context.deallocate_memory(size);
        }
    }

    pub fn start_execution(&mut self, container_id: &str) -> Result<(), JsValue> {
        if let Some(context) = self.container_contexts.get_mut(container_id) {
            context.start_execution();
            
            // 신뢰할 수 있는 컨테이너인지 확인
            if !context.is_trusted() {
                log::warn!("⚠️ 신뢰할 수 없는 컨테이너 실행: {}", container_id);
            }

            return Ok(());
        }

        Err(JsValue::from_str("Container security context not found"))
    }

    pub fn verify_container_signature(&mut self, container_id: &str, signature: &str, data: &[u8]) -> Result<(), JsValue> {
        if let Some(context) = self.container_contexts.get_mut(container_id) {
            if let Err(violation) = context.verify_signature(signature, data) {
                self.handle_security_violation(container_id, violation)?;
                return Err(JsValue::from_str("Signature verification failed"));
            }

            log::info!("✅ 서명 검증 성공: {}", container_id);
            return Ok(());
        }

        Err(JsValue::from_str("Container security context not found"))
    }

    fn handle_security_violation(&mut self, container_id: &str, violation: SecurityViolation) -> Result<(), JsValue> {
        log::error!("🚨 보안 위반: {} - {}", container_id, violation.description);

        // 보안 이벤트 생성
        let event = SecurityEvent {
            event_type: match violation.violation_type {
                SecurityViolationType::UnauthorizedFunctionCall => SecurityEventType::UnauthorizedFunctionCall,
                SecurityViolationType::MemoryLimitExceeded => SecurityEventType::MemoryLimitExceeded,
                SecurityViolationType::ExecutionTimeExceeded => SecurityEventType::ExecutionTimeExceeded,
                SecurityViolationType::InvalidSignature => SecurityEventType::InvalidSignature,
                SecurityViolationType::PolicyViolation => SecurityEventType::PolicyViolation,
                SecurityViolationType::AccessDenied => SecurityEventType::AccessDenied,
            },
            container_id: container_id.to_string(),
            description: violation.description.clone(),
            severity: violation.severity.clone(),
            timestamp: Utc::now(),
            metadata: HashMap::new(),
        };

        self.security_events.push(event.clone());

        // 컨테이너 컨텍스트에도 기록
        if let Some(context) = self.container_contexts.get_mut(container_id) {
            context.add_security_event(event);
        }

        // 감사 로그 기록
        let audit_entry = AuditEntry {
            action: AuditAction::SecurityViolation,
            container_id: container_id.to_string(),
            timestamp: Utc::now(),
            details: violation.description,
        };
        self.audit_log.push(audit_entry);

        // 심각한 위반의 경우 즉시 차단
        match violation.severity {
            SecuritySeverity::Critical => {
                log::error!("🚫 컨테이너 즉시 차단: {}", container_id);
                self.block_container(container_id);
            }
            SecuritySeverity::High => {
                log::warn!("⚠️ 높은 위험도 보안 위반: {}", container_id);
            }
            _ => {}
        }

        Ok(())
    }

    fn block_container(&mut self, container_id: &str) {
        // 컨테이너 차단 (정책을 가장 제한적으로 변경)
        if let Some(context) = self.container_contexts.get_mut(container_id) {
            context.policy = SecurityPolicy::strict();
            context.policy.allowed_functions.clear(); // 모든 함수 차단
        }
    }

    pub fn detect_threats(&mut self) {
        if !self.threat_detection_enabled {
            return;
        }

        log::debug!("🔍 위협 탐지 시작");

        for (container_id, context) in &self.container_contexts {
            // 비정상적인 메모리 사용 패턴
            if context.memory_allocated > context.policy.max_memory * 80 / 100 {
                let event = SecurityEvent {
                    event_type: SecurityEventType::SuspiciousActivity,
                    container_id: container_id.clone(),
                    description: "높은 메모리 사용률 감지".to_string(),
                    severity: SecuritySeverity::Medium,
                    timestamp: Utc::now(),
                    metadata: HashMap::new(),
                };
                
                // self는 이미 빌린 상태이므로 직접 추가
                // 대신 별도 벡터에 저장 후 나중에 추가
            }

            // 과도한 함수 호출
            if context.function_calls > 10000 {
                log::warn!("⚠️ 과도한 함수 호출 감지: {} ({}회)", container_id, context.function_calls);
            }
        }
    }

    pub fn get_container_security_status(&self, container_id: &str) -> Option<SecurityStatus> {
        let context = self.container_contexts.get(container_id)?;
        
        Some(SecurityStatus {
            container_id: container_id.to_string(),
            isolation_level: context.policy.isolation_level.clone(),
            is_trusted: context.is_trusted(),
            memory_allocated: context.memory_allocated,
            memory_limit: context.policy.max_memory,
            function_calls: context.function_calls,
            security_events_count: context.security_events.len(),
            last_violation: context.security_events.last().map(|e| e.timestamp),
        })
    }

    pub fn get_security_events(&self, container_id: Option<&str>) -> Vec<&SecurityEvent> {
        match container_id {
            Some(id) => {
                if let Some(context) = self.container_contexts.get(id) {
                    context.security_events.iter().collect()
                } else {
                    Vec::new()
                }
            }
            None => self.security_events.iter().collect(),
        }
    }

    pub fn get_audit_log(&self) -> &Vec<AuditEntry> {
        &self.audit_log
    }

    pub fn cleanup_container(&mut self, container_id: &str) {
        self.container_contexts.remove(container_id);
        
        // 감사 로그 기록
        let audit_entry = AuditEntry {
            action: AuditAction::ContainerCleaned,
            container_id: container_id.to_string(),
            timestamp: Utc::now(),
            details: "컨테이너 보안 컨텍스트 정리".to_string(),
        };
        self.audit_log.push(audit_entry);

        log::info!("🧹 보안 컨텍스트 정리: {}", container_id);
    }

    pub fn set_global_policy(&mut self, policy: SecurityPolicy) {
        self.global_policy = policy;
        log::info!("🌐 전역 보안 정책 설정");
    }

    pub fn enable_threat_detection(&mut self, enabled: bool) {
        self.threat_detection_enabled = enabled;
        log::info!("🔍 위협 탐지 {}", if enabled { "활성화" } else { "비활성화" });
    }

    pub fn generate_security_report(&self) -> SecurityReport {
        let total_violations = self.security_events.len();
        let critical_violations = self.security_events.iter()
            .filter(|e| matches!(e.severity, SecuritySeverity::Critical))
            .count();
        let high_violations = self.security_events.iter()
            .filter(|e| matches!(e.severity, SecuritySeverity::High))
            .count();

        SecurityReport {
            generated_at: Utc::now(),
            total_containers: self.container_contexts.len(),
            total_violations,
            critical_violations,
            high_violations,
            threat_detection_enabled: self.threat_detection_enabled,
            recent_events: self.security_events.iter()
                .rev()
                .take(10)
                .cloned()
                .collect(),
        }
    }

    pub fn cleanup_old_events(&mut self, retention_days: i64) {
        let cutoff_date = Utc::now() - chrono::Duration::days(retention_days);
        
        self.security_events.retain(|event| event.timestamp > cutoff_date);
        self.audit_log.retain(|entry| entry.timestamp > cutoff_date);

        for context in self.container_contexts.values_mut() {
            context.security_events.retain(|event| event.timestamp > cutoff_date);
        }

        log::info!("🧹 오래된 보안 이벤트 정리 완료 ({}일 이전)", retention_days);
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SecurityStatus {
    pub container_id: String,
    pub isolation_level: IsolationLevel,
    pub is_trusted: bool,
    pub memory_allocated: u32,
    pub memory_limit: u32,
    pub function_calls: u32,
    pub security_events_count: usize,
    pub last_violation: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SecurityReport {
    pub generated_at: DateTime<Utc>,
    pub total_containers: usize,
    pub total_violations: usize,
    pub critical_violations: usize,
    pub high_violations: usize,
    pub threat_detection_enabled: bool,
    pub recent_events: Vec<SecurityEvent>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditEntry {
    pub action: AuditAction,
    pub container_id: String,
    pub timestamp: DateTime<Utc>,
    pub details: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum AuditAction {
    PolicyApplied,
    FunctionCalled,
    SecurityViolation,
    ContainerCleaned,
    MemoryAllocated,
    MemoryDeallocated,
} 