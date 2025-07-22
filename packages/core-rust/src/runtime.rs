use wasm_bindgen::prelude::*;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub enum RuntimeType {
    Browser,
    NodeJS,
    Wasmtime,
    WasmEdge,
    Wasmer,
}

impl RuntimeType {
    pub fn from_string(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "browser" => RuntimeType::Browser,
            "nodejs" | "node" => RuntimeType::NodeJS,
            "wasmtime" => RuntimeType::Wasmtime,
            "wasmedge" => RuntimeType::WasmEdge,
            "wasmer" => RuntimeType::Wasmer,
            _ => RuntimeType::Browser, // default
        }
    }

    pub fn to_string(&self) -> String {
        match self {
            RuntimeType::Browser => "browser".to_string(),
            RuntimeType::NodeJS => "nodejs".to_string(),
            RuntimeType::Wasmtime => "wasmtime".to_string(),
            RuntimeType::WasmEdge => "wasmedge".to_string(),
            RuntimeType::Wasmer => "wasmer".to_string(),
        }
    }

    pub fn supports_feature(&self, feature: &RuntimeFeature) -> bool {
        match (self, feature) {
            // Browser runtime features
            (RuntimeType::Browser, RuntimeFeature::WebAPI) => true,
            (RuntimeType::Browser, RuntimeFeature::DOM) => true,
            (RuntimeType::Browser, RuntimeFeature::WebGL) => true,
            (RuntimeType::Browser, RuntimeFeature::WebAssemblyStreaming) => true,
            (RuntimeType::Browser, RuntimeFeature::SharedArrayBuffer) => true,
            
            // Node.js runtime features
            (RuntimeType::NodeJS, RuntimeFeature::FileSystem) => true,
            (RuntimeType::NodeJS, RuntimeFeature::NetworkAccess) => true,
            (RuntimeType::NodeJS, RuntimeFeature::ProcessControl) => true,
            (RuntimeType::NodeJS, RuntimeFeature::CryptoAPI) => true,
            
            // Wasmtime features
            (RuntimeType::Wasmtime, RuntimeFeature::WASI) => true,
            (RuntimeType::Wasmtime, RuntimeFeature::MultiValue) => true,
            (RuntimeType::Wasmtime, RuntimeFeature::BulkMemory) => true,
            (RuntimeType::Wasmtime, RuntimeFeature::ReferenceTypes) => true,
            
            // WasmEdge features
            (RuntimeType::WasmEdge, RuntimeFeature::WASI) => true,
            (RuntimeType::WasmEdge, RuntimeFeature::AIInference) => true,
            (RuntimeType::WasmEdge, RuntimeFeature::ImageProcessing) => true,
            (RuntimeType::WasmEdge, RuntimeFeature::SocketAPI) => true,
            
            // Wasmer features
            (RuntimeType::Wasmer, RuntimeFeature::CrossPlatform) => true,
            (RuntimeType::Wasmer, RuntimeFeature::MultipleEngines) => true,
            (RuntimeType::Wasmer, RuntimeFeature::WASI) => true,
            (RuntimeType::Wasmer, RuntimeFeature::JITCompilation) => true,
            
            // Common features
            (_, RuntimeFeature::BasicWasm) => true,
            (_, RuntimeFeature::MemoryManagement) => true,
            
            _ => false,
        }
    }

    pub fn get_performance_characteristics(&self) -> PerformanceCharacteristics {
        match self {
            RuntimeType::Browser => PerformanceCharacteristics {
                startup_time: RuntimeSpeed::Fast,
                execution_speed: RuntimeSpeed::Medium,
                memory_efficiency: RuntimeSpeed::Medium,
                compilation_speed: RuntimeSpeed::Fast,
                cold_start: RuntimeSpeed::Fast,
                concurrent_execution: true,
                gc_performance: RuntimeSpeed::Medium,
            },
            RuntimeType::NodeJS => PerformanceCharacteristics {
                startup_time: RuntimeSpeed::Medium,
                execution_speed: RuntimeSpeed::Fast,
                memory_efficiency: RuntimeSpeed::Medium,
                compilation_speed: RuntimeSpeed::Fast,
                cold_start: RuntimeSpeed::Medium,
                concurrent_execution: true,
                gc_performance: RuntimeSpeed::Fast,
            },
            RuntimeType::Wasmtime => PerformanceCharacteristics {
                startup_time: RuntimeSpeed::Medium,
                execution_speed: RuntimeSpeed::VeryFast,
                memory_efficiency: RuntimeSpeed::Fast,
                compilation_speed: RuntimeSpeed::Medium,
                cold_start: RuntimeSpeed::Medium,
                concurrent_execution: true,
                gc_performance: RuntimeSpeed::Fast,
            },
            RuntimeType::WasmEdge => PerformanceCharacteristics {
                startup_time: RuntimeSpeed::Fast,
                execution_speed: RuntimeSpeed::VeryFast,
                memory_efficiency: RuntimeSpeed::Fast,
                compilation_speed: RuntimeSpeed::Fast,
                cold_start: RuntimeSpeed::Fast,
                concurrent_execution: true,
                gc_performance: RuntimeSpeed::Fast,
            },
            RuntimeType::Wasmer => PerformanceCharacteristics {
                startup_time: RuntimeSpeed::Medium,
                execution_speed: RuntimeSpeed::VeryFast,
                memory_efficiency: RuntimeSpeed::Fast,
                compilation_speed: RuntimeSpeed::Medium,
                cold_start: RuntimeSpeed::Medium,
                concurrent_execution: true,
                gc_performance: RuntimeSpeed::Fast,
            },
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum RuntimeFeature {
    // Basic WASM features
    BasicWasm,
    MemoryManagement,
    
    // Browser-specific
    WebAPI,
    DOM,
    WebGL,
    WebAssemblyStreaming,
    SharedArrayBuffer,
    
    // Node.js-specific
    FileSystem,
    NetworkAccess,
    ProcessControl,
    CryptoAPI,
    
    // Advanced WASM features
    WASI,
    MultiValue,
    BulkMemory,
    ReferenceTypes,
    SIMD,
    Threads,
    
    // Engine-specific features
    AIInference,
    ImageProcessing,
    SocketAPI,
    CrossPlatform,
    MultipleEngines,
    JITCompilation,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum RuntimeSpeed {
    VerySlow,
    Slow,
    Medium,
    Fast,
    VeryFast,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PerformanceCharacteristics {
    pub startup_time: RuntimeSpeed,
    pub execution_speed: RuntimeSpeed,
    pub memory_efficiency: RuntimeSpeed,
    pub compilation_speed: RuntimeSpeed,
    pub cold_start: RuntimeSpeed,
    pub concurrent_execution: bool,
    pub gc_performance: RuntimeSpeed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RuntimeCapabilities {
    pub runtime_type: RuntimeType,
    pub supported_features: Vec<RuntimeFeature>,
    pub performance: PerformanceCharacteristics,
    pub max_memory: u32,
    pub max_modules: u32,
    pub supports_streaming: bool,
    pub supports_compilation_cache: bool,
    pub optimization_level: OptimizationLevel,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum OptimizationLevel {
    None,
    Basic,
    Aggressive,
    MaxPerformance,
}

#[derive(Debug)]
pub struct RuntimeEngine {
    current_runtime: RuntimeType,
    available_runtimes: HashMap<RuntimeType, RuntimeCapabilities>,
    runtime_stats: HashMap<RuntimeType, RuntimeStats>,
    auto_selection_enabled: bool,
    fallback_runtime: RuntimeType,
}

impl RuntimeEngine {
    pub fn new() -> Self {
        let mut engine = RuntimeEngine {
            current_runtime: RuntimeType::Browser,
            available_runtimes: HashMap::new(),
            runtime_stats: HashMap::new(),
            auto_selection_enabled: true,
            fallback_runtime: RuntimeType::Browser,
        };

        // 기본 런타임들 초기화
        engine.initialize_default_runtimes();
        engine
    }

    fn initialize_default_runtimes(&mut self) {
        // Browser runtime
        let browser_features = vec![
            RuntimeFeature::BasicWasm,
            RuntimeFeature::MemoryManagement,
            RuntimeFeature::WebAPI,
            RuntimeFeature::DOM,
            RuntimeFeature::WebGL,
            RuntimeFeature::WebAssemblyStreaming,
            RuntimeFeature::SharedArrayBuffer,
        ];

        let browser_capabilities = RuntimeCapabilities {
            runtime_type: RuntimeType::Browser,
            supported_features: browser_features,
            performance: RuntimeType::Browser.get_performance_characteristics(),
            max_memory: 2048 * 1024 * 1024, // 2GB (브라우저 제한)
            max_modules: 100,
            supports_streaming: true,
            supports_compilation_cache: true,
            optimization_level: OptimizationLevel::Basic,
        };

        self.available_runtimes.insert(RuntimeType::Browser, browser_capabilities);
        self.runtime_stats.insert(RuntimeType::Browser, RuntimeStats::new());

        // Node.js runtime
        let nodejs_features = vec![
            RuntimeFeature::BasicWasm,
            RuntimeFeature::MemoryManagement,
            RuntimeFeature::FileSystem,
            RuntimeFeature::NetworkAccess,
            RuntimeFeature::ProcessControl,
            RuntimeFeature::CryptoAPI,
        ];

        let nodejs_capabilities = RuntimeCapabilities {
            runtime_type: RuntimeType::NodeJS,
            supported_features: nodejs_features,
            performance: RuntimeType::NodeJS.get_performance_characteristics(),
            max_memory: 8192 * 1024 * 1024, // 8GB
            max_modules: 1000,
            supports_streaming: true,
            supports_compilation_cache: true,
            optimization_level: OptimizationLevel::Aggressive,
        };

        self.available_runtimes.insert(RuntimeType::NodeJS, nodejs_capabilities);
        self.runtime_stats.insert(RuntimeType::NodeJS, RuntimeStats::new());

        // 다른 런타임들도 유사하게 초기화...
        self.initialize_wasmtime();
        self.initialize_wasmedge();
        self.initialize_wasmer();
    }

    fn initialize_wasmtime(&mut self) {
        let wasmtime_features = vec![
            RuntimeFeature::BasicWasm,
            RuntimeFeature::MemoryManagement,
            RuntimeFeature::WASI,
            RuntimeFeature::MultiValue,
            RuntimeFeature::BulkMemory,
            RuntimeFeature::ReferenceTypes,
            RuntimeFeature::SIMD,
            RuntimeFeature::Threads,
        ];

        let wasmtime_capabilities = RuntimeCapabilities {
            runtime_type: RuntimeType::Wasmtime,
            supported_features: wasmtime_features,
            performance: RuntimeType::Wasmtime.get_performance_characteristics(),
            max_memory: 16384 * 1024 * 1024, // 16GB
            max_modules: 10000,
            supports_streaming: true,
            supports_compilation_cache: true,
            optimization_level: OptimizationLevel::MaxPerformance,
        };

        self.available_runtimes.insert(RuntimeType::Wasmtime, wasmtime_capabilities);
        self.runtime_stats.insert(RuntimeType::Wasmtime, RuntimeStats::new());
    }

    fn initialize_wasmedge(&mut self) {
        let wasmedge_features = vec![
            RuntimeFeature::BasicWasm,
            RuntimeFeature::MemoryManagement,
            RuntimeFeature::WASI,
            RuntimeFeature::AIInference,
            RuntimeFeature::ImageProcessing,
            RuntimeFeature::SocketAPI,
            RuntimeFeature::Threads,
        ];

        let wasmedge_capabilities = RuntimeCapabilities {
            runtime_type: RuntimeType::WasmEdge,
            supported_features: wasmedge_features,
            performance: RuntimeType::WasmEdge.get_performance_characteristics(),
            max_memory: 32768 * 1024 * 1024, // 32GB
            max_modules: 10000,
            supports_streaming: true,
            supports_compilation_cache: true,
            optimization_level: OptimizationLevel::MaxPerformance,
        };

        self.available_runtimes.insert(RuntimeType::WasmEdge, wasmedge_capabilities);
        self.runtime_stats.insert(RuntimeType::WasmEdge, RuntimeStats::new());
    }

    fn initialize_wasmer(&mut self) {
        let wasmer_features = vec![
            RuntimeFeature::BasicWasm,
            RuntimeFeature::MemoryManagement,
            RuntimeFeature::WASI,
            RuntimeFeature::CrossPlatform,
            RuntimeFeature::MultipleEngines,
            RuntimeFeature::JITCompilation,
            RuntimeFeature::Threads,
        ];

        let wasmer_capabilities = RuntimeCapabilities {
            runtime_type: RuntimeType::Wasmer,
            supported_features: wasmer_features,
            performance: RuntimeType::Wasmer.get_performance_characteristics(),
            max_memory: 16384 * 1024 * 1024, // 16GB
            max_modules: 5000,
            supports_streaming: true,
            supports_compilation_cache: true,
            optimization_level: OptimizationLevel::MaxPerformance,
        };

        self.available_runtimes.insert(RuntimeType::Wasmer, wasmer_capabilities);
        self.runtime_stats.insert(RuntimeType::Wasmer, RuntimeStats::new());
    }

    pub fn select_runtime(&mut self, runtime_type: RuntimeType) -> Result<(), JsValue> {
        if !self.available_runtimes.contains_key(&runtime_type) {
            return Err(JsValue::from_str("Runtime not available"));
        }

        self.current_runtime = runtime_type.clone();
        log::info!("🔄 런타임 변경: {:?}", runtime_type);

        // 런타임 변경 통계 업데이트
        if let Some(stats) = self.runtime_stats.get_mut(&runtime_type) {
            stats.selection_count += 1;
        }

        Ok(())
    }

    pub fn auto_select_runtime(&mut self, requirements: &RuntimeRequirements) -> RuntimeType {
        if !self.auto_selection_enabled {
            return self.current_runtime.clone();
        }

        log::debug!("🤖 자동 런타임 선택 중...");

        let mut best_runtime = self.fallback_runtime.clone();
        let mut best_score = 0.0;

        for (runtime_type, capabilities) in &self.available_runtimes {
            let score = self.calculate_runtime_score(runtime_type, capabilities, requirements);
            
            if score > best_score {
                best_score = score;
                best_runtime = runtime_type.clone();
            }
        }

        if best_runtime != self.current_runtime {
            log::info!("🎯 최적 런타임 선택: {:?} (점수: {:.2})", best_runtime, best_score);
            self.current_runtime = best_runtime.clone();
        }

        best_runtime
    }

    fn calculate_runtime_score(
        &self, 
        runtime_type: &RuntimeType,
        capabilities: &RuntimeCapabilities,
        requirements: &RuntimeRequirements
    ) -> f64 {
        let mut score = 0.0;

        // 필수 기능 지원 확인 (가중치: 40%)
        let required_features_supported = requirements.required_features.iter()
            .all(|feature| capabilities.supported_features.contains(feature));
        
        if !required_features_supported {
            return 0.0; // 필수 기능 미지원 시 제외
        }
        
        score += 40.0;

        // 성능 특성 평가 (가중치: 30%)
        let performance_score = self.evaluate_performance(&capabilities.performance, requirements);
        score += performance_score * 0.3;

        // 메모리 요구사항 (가중치: 15%)
        if capabilities.max_memory >= requirements.memory_requirement {
            score += 15.0;
        } else {
            score += 15.0 * (capabilities.max_memory as f64 / requirements.memory_requirement as f64);
        }

        // 런타임 통계 기반 (가중치: 10%)
        if let Some(stats) = self.runtime_stats.get(runtime_type) {
            let reliability_score = if stats.error_count > 0 {
                1.0 - (stats.error_count as f64 / (stats.execution_count + 1) as f64)
            } else {
                1.0
            };
            score += reliability_score * 10.0;
        }

        // 최적화 레벨 (가중치: 5%)
        let optimization_score = match capabilities.optimization_level {
            OptimizationLevel::MaxPerformance => 5.0,
            OptimizationLevel::Aggressive => 4.0,
            OptimizationLevel::Basic => 2.0,
            OptimizationLevel::None => 0.0,
        };
        score += optimization_score;

        score
    }

    fn evaluate_performance(&self, performance: &PerformanceCharacteristics, requirements: &RuntimeRequirements) -> f64 {
        let speed_to_score = |speed: &RuntimeSpeed| -> f64 {
            match speed {
                RuntimeSpeed::VeryFast => 5.0,
                RuntimeSpeed::Fast => 4.0,
                RuntimeSpeed::Medium => 3.0,
                RuntimeSpeed::Slow => 2.0,
                RuntimeSpeed::VerySlow => 1.0,
            }
        };

        let mut total_score = 0.0;
        let mut weight_sum = 0.0;

        // 각 성능 특성에 대한 가중치
        let weights = &requirements.performance_weights;

        total_score += speed_to_score(&performance.startup_time) * weights.startup_time;
        weight_sum += weights.startup_time;

        total_score += speed_to_score(&performance.execution_speed) * weights.execution_speed;
        weight_sum += weights.execution_speed;

        total_score += speed_to_score(&performance.memory_efficiency) * weights.memory_efficiency;
        weight_sum += weights.memory_efficiency;

        total_score += speed_to_score(&performance.compilation_speed) * weights.compilation_speed;
        weight_sum += weights.compilation_speed;

        if weight_sum > 0.0 {
            total_score / weight_sum
        } else {
            3.0 // 기본값
        }
    }

    pub fn get_current_runtime(&self) -> &RuntimeType {
        &self.current_runtime
    }

    pub fn get_runtime_capabilities(&self, runtime_type: &RuntimeType) -> Option<&RuntimeCapabilities> {
        self.available_runtimes.get(runtime_type)
    }

    pub fn is_feature_supported(&self, feature: &RuntimeFeature) -> bool {
        if let Some(capabilities) = self.available_runtimes.get(&self.current_runtime) {
            capabilities.supported_features.contains(feature)
        } else {
            false
        }
    }

    pub fn record_execution(&mut self, runtime_type: &RuntimeType, success: bool, execution_time: f64) {
        if let Some(stats) = self.runtime_stats.get_mut(runtime_type) {
            stats.execution_count += 1;
            
            if success {
                stats.success_count += 1;
                stats.total_execution_time += execution_time;
                stats.average_execution_time = stats.total_execution_time / stats.success_count as f64;
                
                if execution_time < stats.min_execution_time {
                    stats.min_execution_time = execution_time;
                }
                
                if execution_time > stats.max_execution_time {
                    stats.max_execution_time = execution_time;
                }
            } else {
                stats.error_count += 1;
            }
        }
    }

    pub fn get_runtime_stats(&self, runtime_type: &RuntimeType) -> Option<&RuntimeStats> {
        self.runtime_stats.get(runtime_type)
    }

    pub fn get_all_runtime_stats(&self) -> &HashMap<RuntimeType, RuntimeStats> {
        &self.runtime_stats
    }

    pub fn enable_auto_selection(&mut self, enabled: bool) {
        self.auto_selection_enabled = enabled;
        log::info!("🤖 자동 런타임 선택 {}", if enabled { "활성화" } else { "비활성화" });
    }

    pub fn set_fallback_runtime(&mut self, runtime_type: RuntimeType) {
        self.fallback_runtime = runtime_type;
        log::info!("🔄 기본 런타임 설정: {:?}", self.fallback_runtime);
    }

    pub fn benchmark_runtimes(&mut self, workload: &RuntimeWorkload) -> HashMap<RuntimeType, BenchmarkResult> {
        let mut results = HashMap::new();

        for runtime_type in self.available_runtimes.keys() {
            log::info!("📊 런타임 벤치마크 실행: {:?}", runtime_type);
            
            let result = self.run_benchmark(runtime_type, workload);
            results.insert(runtime_type.clone(), result);
        }

        results
    }

    fn run_benchmark(&self, runtime_type: &RuntimeType, workload: &RuntimeWorkload) -> BenchmarkResult {
        // 실제 벤치마크 구현 (여기서는 시뮬레이션)
        let capabilities = self.available_runtimes.get(runtime_type).unwrap();
        
        let startup_time = match capabilities.performance.startup_time {
            RuntimeSpeed::VeryFast => 50.0,
            RuntimeSpeed::Fast => 100.0,
            RuntimeSpeed::Medium => 200.0,
            RuntimeSpeed::Slow => 500.0,
            RuntimeSpeed::VerySlow => 1000.0,
        };

        let execution_time = match capabilities.performance.execution_speed {
            RuntimeSpeed::VeryFast => workload.operations as f64 * 0.001,
            RuntimeSpeed::Fast => workload.operations as f64 * 0.002,
            RuntimeSpeed::Medium => workload.operations as f64 * 0.005,
            RuntimeSpeed::Slow => workload.operations as f64 * 0.01,
            RuntimeSpeed::VerySlow => workload.operations as f64 * 0.02,
        };

        let memory_usage = workload.memory_operations as u32 * 1024; // KB

        BenchmarkResult {
            runtime_type: runtime_type.clone(),
            startup_time,
            execution_time,
            memory_usage,
            throughput: workload.operations as f64 / execution_time,
            success_rate: 0.99, // 99% 성공률 가정
        }
    }

    pub fn cleanup(&mut self) {
        log::info!("🧹 런타임 엔진 정리");
        
        // 통계 리셋
        for stats in self.runtime_stats.values_mut() {
            stats.reset();
        }
    }
}

#[derive(Debug, Clone)]
pub struct RuntimeRequirements {
    pub required_features: Vec<RuntimeFeature>,
    pub memory_requirement: u32,
    pub performance_weights: PerformanceWeights,
    pub optimization_preference: OptimizationLevel,
}

#[derive(Debug, Clone)]
pub struct PerformanceWeights {
    pub startup_time: f64,
    pub execution_speed: f64,
    pub memory_efficiency: f64,
    pub compilation_speed: f64,
}

impl Default for PerformanceWeights {
    fn default() -> Self {
        PerformanceWeights {
            startup_time: 1.0,
            execution_speed: 2.0,
            memory_efficiency: 1.0,
            compilation_speed: 1.0,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RuntimeStats {
    pub execution_count: u32,
    pub success_count: u32,
    pub error_count: u32,
    pub selection_count: u32,
    pub total_execution_time: f64,
    pub average_execution_time: f64,
    pub min_execution_time: f64,
    pub max_execution_time: f64,
}

impl RuntimeStats {
    pub fn new() -> Self {
        RuntimeStats {
            execution_count: 0,
            success_count: 0,
            error_count: 0,
            selection_count: 0,
            total_execution_time: 0.0,
            average_execution_time: 0.0,
            min_execution_time: f64::MAX,
            max_execution_time: 0.0,
        }
    }

    pub fn reset(&mut self) {
        *self = RuntimeStats::new();
    }

    pub fn get_success_rate(&self) -> f64 {
        if self.execution_count > 0 {
            self.success_count as f64 / self.execution_count as f64
        } else {
            0.0
        }
    }
}

#[derive(Debug, Clone)]
pub struct RuntimeWorkload {
    pub operations: u64,
    pub memory_operations: u64,
    pub complexity: WorkloadComplexity,
}

#[derive(Debug, Clone)]
pub enum WorkloadComplexity {
    Light,
    Medium,
    Heavy,
    Extreme,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BenchmarkResult {
    pub runtime_type: RuntimeType,
    pub startup_time: f64,
    pub execution_time: f64,
    pub memory_usage: u32,
    pub throughput: f64,
    pub success_rate: f64,
} 