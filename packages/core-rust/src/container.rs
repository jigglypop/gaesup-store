use wasm_bindgen::prelude::*;
use wasm_bindgen_futures::JsFuture;
use js_sys::{WebAssembly, Object, Uint8Array, Function};
use web_sys::Response;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use chrono::{DateTime, Utc};
use uuid::Uuid;

use crate::state::{StateValue, JSContainerState};
use crate::runtime::RuntimeType;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContainerConfig {
    pub id: String,
    pub name: String,
    pub wasm_url: Option<String>,
    pub initial_state: StateValue,
    pub memory_limit: u32,
    pub enable_metrics: bool,
    pub enable_security: bool,
    pub runtime_type: RuntimeType,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum ContainerStatus {
    Created,
    Starting,
    Running,
    Paused,
    Stopping,
    Stopped,
    Error,
}

impl ContainerStatus {
    pub fn to_string(&self) -> String {
        match self {
            ContainerStatus::Created => "created".to_string(),
            ContainerStatus::Starting => "starting".to_string(),
            ContainerStatus::Running => "running".to_string(),
            ContainerStatus::Paused => "paused".to_string(),
            ContainerStatus::Stopping => "stopping".to_string(),
            ContainerStatus::Stopped => "stopped".to_string(),
            ContainerStatus::Error => "error".to_string(),
        }
    }
}

#[derive(Debug)]
pub struct WasmContainer {
    config: ContainerConfig,
    status: ContainerStatus,
    wasm_instance: Option<Object>,
    wasm_module: Option<Object>,
    state: StateValue,
    created_at: DateTime<Utc>,
    last_accessed: DateTime<Utc>,
    function_cache: HashMap<String, Function>,
    memory_usage: u32,
}

impl WasmContainer {
    /// 새로운 컨테이너 생성
    pub async fn new(config: ContainerConfig) -> Result<Self, JsValue> {
        log::info!("🏗️ 새 컨테이너 생성 중: {}", config.name);

        let mut container = WasmContainer {
            config: config.clone(),
            status: ContainerStatus::Created,
            wasm_instance: None,
            wasm_module: None,
            state: config.initial_state.clone(),
            created_at: Utc::now(),
            last_accessed: Utc::now(),
            function_cache: HashMap::new(),
            memory_usage: 0,
        };

        // WASM 모듈 로드 및 인스턴스 생성
        if let Some(wasm_url) = &config.wasm_url {
            container.load_wasm_module(wasm_url).await?;
        } else {
            // Mock WASM 모듈 생성 (테스트/개발용)
            container.create_mock_module().await?;
        }

        container.status = ContainerStatus::Running;
        log::info!("✅ 컨테이너 생성 완료: {}", config.name);

        Ok(container)
    }

    /// WASM 모듈 로드
    async fn load_wasm_module(&mut self, wasm_url: &str) -> Result<(), JsValue> {
        self.status = ContainerStatus::Starting;
        
        log::debug!("📥 WASM 모듈 로드 중: {}", wasm_url);

        // WASM 바이트코드 페치
        let window = web_sys::window().ok_or("No window object")?;
        let resp_value = JsFuture::from(window.fetch_with_str(wasm_url)).await?;
        let resp: Response = resp_value.dyn_into()?;
        let array_buffer = JsFuture::from(resp.array_buffer()?).await?;

        // WASM 모듈 컴파일
        let wasm_module = JsFuture::from(WebAssembly::compile(&array_buffer)).await?;
        let module: Object = wasm_module.dyn_into()?;

        // 임포트 객체 생성
        let import_object = self.create_import_object()?;

        // WASM 인스턴스 생성
        let instance_promise = WebAssembly::instantiate_module(&module, &import_object);
        let wasm_instance = JsFuture::from(instance_promise).await?;
        let instance: Object = wasm_instance.dyn_into()?;

        self.wasm_module = Some(module);
        self.wasm_instance = Some(instance);

        // 메모리 사용량 업데이트
        self.update_memory_usage();

        log::debug!("✅ WASM 모듈 로드 완료");
        Ok(())
    }

    /// Mock WASM 모듈 생성 (개발/테스트용)
    async fn create_mock_module(&mut self) -> Result<(), JsValue> {
        log::debug!("🎭 Mock WASM 모듈 생성");

        // 최소한의 WASM 바이트코드 (유효한 모듈)
        let wasm_bytes = vec![
            0x00, 0x61, 0x73, 0x6d, // WASM magic
            0x01, 0x00, 0x00, 0x00, // WASM version
        ];

        let uint8_array = Uint8Array::new_with_length(wasm_bytes.len() as u32);
        uint8_array.copy_from(&wasm_bytes);

        // Mock 함수들을 포함한 임포트 객체 생성
        let import_object = self.create_mock_import_object()?;

        // Mock 인스턴스 생성 (실제로는 JavaScript 함수들)
        self.create_mock_instance()?;

        self.memory_usage = 1024; // 1KB mock 메모리
        log::debug!("✅ Mock WASM 모듈 생성 완료");

        Ok(())
    }

    /// WASM 임포트 객체 생성
    fn create_import_object(&self) -> Result<Object, JsValue> {
        let import_object = Object::new();

        // 환경 임포트
        let env = Object::new();
        
        // 콘솔 로깅 함수
        let console_log = Closure::wrap(Box::new(|ptr: u32, len: u32| {
            log::info!("WASM Log: ptr={}, len={}", ptr, len);
        }) as Box<dyn Fn(u32, u32)>);
        
        js_sys::Reflect::set(&env, &"console_log".into(), console_log.as_ref().unchecked_ref())?;
        console_log.forget(); // 메모리 누수 방지를 위해 수동 관리

        // 메모리 관리 함수들
        let malloc = Closure::wrap(Box::new(|size: u32| -> u32 {
            log::debug!("WASM malloc: {} bytes", size);
            size // 단순화된 메모리 할당
        }) as Box<dyn Fn(u32) -> u32>);
        
        js_sys::Reflect::set(&env, &"malloc".into(), malloc.as_ref().unchecked_ref())?;
        malloc.forget();

        let free = Closure::wrap(Box::new(|ptr: u32| {
            log::debug!("WASM free: ptr={}", ptr);
        }) as Box<dyn Fn(u32)>);
        
        js_sys::Reflect::set(&env, &"free".into(), free.as_ref().unchecked_ref())?;
        free.forget();

        js_sys::Reflect::set(&import_object, &"env".into(), &env)?;

        Ok(import_object)
    }

    /// Mock 임포트 객체 생성
    fn create_mock_import_object(&self) -> Result<Object, JsValue> {
        let import_object = Object::new();
        let env = Object::new();

        // Mock 환경 함수들
        let noop = js_sys::Function::new_no_args("return 0;");
        js_sys::Reflect::set(&env, &"console_log".into(), &noop)?;
        js_sys::Reflect::set(&env, &"malloc".into(), &noop)?;
        js_sys::Reflect::set(&env, &"free".into(), &noop)?;

        js_sys::Reflect::set(&import_object, &"env".into(), &env)?;
        Ok(import_object)
    }

    /// Mock 인스턴스 생성 (JavaScript 기반)
    fn create_mock_instance(&mut self) -> Result<(), JsValue> {
        // Mock 함수들을 캐시에 추가
        let increment_fn = js_sys::Function::new_with_args(
            "framework",
            r#"
            const state = this._state || { count: 0, lastUpdated: Date.now(), framework: 'none' };
            state.count += 1;
            state.lastUpdated = Date.now();
            state.framework = framework || 'unknown';
            this._state = state;
            return state.count;
            "#
        );

        let decrement_fn = js_sys::Function::new_with_args(
            "framework",
            r#"
            const state = this._state || { count: 0, lastUpdated: Date.now(), framework: 'none' };
            state.count -= 1;
            state.lastUpdated = Date.now();
            state.framework = framework || 'unknown';
            this._state = state;
            return state.count;
            "#
        );

        let reset_fn = js_sys::Function::new_with_args(
            "framework",
            r#"
            const state = { count: 0, lastUpdated: Date.now(), framework: framework || 'unknown' };
            this._state = state;
            return 0;
            "#
        );

        let get_state_fn = js_sys::Function::new_no_args(
            r#"
            return this._state || { count: 0, lastUpdated: Date.now(), framework: 'none' };
            "#
        );

        self.function_cache.insert("increment".to_string(), increment_fn);
        self.function_cache.insert("decrement".to_string(), decrement_fn);
        self.function_cache.insert("reset".to_string(), reset_fn);
        self.function_cache.insert("get_state".to_string(), get_state_fn);

        Ok(())
    }

    /// 컨테이너 함수 호출
    pub async fn call_function(&mut self, function_name: &str, args: JsValue) -> Result<JsValue, JsValue> {
        self.last_accessed = Utc::now();

        if self.status != ContainerStatus::Running {
            return Err(JsValue::from_str("Container is not running"));
        }

        log::debug!("🔧 함수 호출: {}", function_name);

        // Mock 함수 호출 (개발용)
        if let Some(function) = self.function_cache.get(function_name) {
            let this = JsValue::NULL;
            let result = match function_name {
                "increment" | "decrement" | "reset" => {
                    let framework = args.as_string().unwrap_or("unknown".to_string());
                    let args_array = js_sys::Array::new();
                    args_array.push(&JsValue::from_str(&framework));
                    function.apply(&this, &args_array)?
                }
                "get_state" => {
                    function.call0(&this)?
                }
                _ => {
                    return Err(JsValue::from_str(&format!("Unknown function: {}", function_name)));
                }
            };

            // 상태 업데이트
            if function_name != "get_state" {
                self.update_state_from_result(&result)?;
            }

            return Ok(result);
        }

        // 실제 WASM 함수 호출
        if let Some(instance) = &self.wasm_instance {
            let exports = instance.exports();
            
            if let Ok(func) = js_sys::Reflect::get(&exports, &function_name.into()) {
                let function: js_sys::Function = func.dyn_into()
                    .map_err(|_| JsValue::from_str("Function not found"))?;

                let args_array = js_sys::Array::new();
                args_array.push(&args);
                
                let result = function.apply(&JsValue::NULL, &args_array)?;
                
                // 메모리 사용량 업데이트
                self.update_memory_usage();
                
                return Ok(result);
            }
        }

        Err(JsValue::from_str(&format!("Function not found: {}", function_name)))
    }

    /// 결과에서 상태 업데이트
    fn update_state_from_result(&mut self, result: &JsValue) -> Result<(), JsValue> {
        // Mock 상태 업데이트 로직
        if let Some(obj) = result.as_f64() {
            if let StateValue::Object(ref mut state) = self.state {
                state.count = obj as i32;
                state.last_updated = js_sys::Date::now();
            }
        }
        Ok(())
    }

    /// 메모리 사용량 업데이트
    fn update_memory_usage(&mut self) {
        if let Some(instance) = &self.wasm_instance {
            let exports = instance.exports();
            if let Ok(memory) = js_sys::Reflect::get(&exports, &"memory".into()) {
                if let Ok(wasm_memory) = memory.dyn_into::<Object>() {
                    let buffer = wasm_memory.buffer();
                    self.memory_usage = buffer.byte_length() as u32;
                }
            }
        }
    }

    /// 컨테이너 중지
    pub async fn stop(&mut self) -> Result<(), JsValue> {
        log::info!("🛑 컨테이너 중지 중: {}", self.config.name);
        
        self.status = ContainerStatus::Stopping;

        // 리소스 정리
        self.wasm_instance = None;
        self.wasm_module = None;
        self.function_cache.clear();
        self.memory_usage = 0;

        self.status = ContainerStatus::Stopped;
        log::info!("✅ 컨테이너 중지 완료: {}", self.config.name);

        Ok(())
    }

    /// 컨테이너 일시정지
    pub fn pause(&mut self) -> Result<(), JsValue> {
        if self.status == ContainerStatus::Running {
            self.status = ContainerStatus::Paused;
            log::info!("⏸️ 컨테이너 일시정지: {}", self.config.name);
            Ok(())
        } else {
            Err(JsValue::from_str("Container is not running"))
        }
    }

    /// 컨테이너 재개
    pub fn resume(&mut self) -> Result<(), JsValue> {
        if self.status == ContainerStatus::Paused {
            self.status = ContainerStatus::Running;
            log::info!("▶️ 컨테이너 재개: {}", self.config.name);
            Ok(())
        } else {
            Err(JsValue::from_str("Container is not paused"))
        }
    }

    /// 컨테이너 상태 리셋
    pub fn reset_state(&mut self) -> Result<(), JsValue> {
        self.state = self.config.initial_state.clone();
        log::info!("🔄 컨테이너 상태 리셋: {}", self.config.name);
        Ok(())
    }

    // Getter 메서드들
    pub fn get_id(&self) -> &str {
        &self.config.id
    }

    pub fn get_name(&self) -> &str {
        &self.config.name
    }

    pub fn get_status(&self) -> &ContainerStatus {
        &self.status
    }

    pub fn get_state(&self) -> &StateValue {
        &self.state
    }

    pub fn get_memory_usage(&self) -> u32 {
        self.memory_usage
    }

    pub fn get_created_at(&self) -> &DateTime<Utc> {
        &self.created_at
    }

    pub fn get_last_accessed(&self) -> &DateTime<Utc> {
        &self.last_accessed
    }

    pub fn is_running(&self) -> bool {
        self.status == ContainerStatus::Running
    }

    /// 컨테이너 설정 업데이트
    pub fn update_config(&mut self, new_config: ContainerConfig) -> Result<(), JsValue> {
        // ID와 name은 변경할 수 없음
        if new_config.id != self.config.id {
            return Err(JsValue::from_str("Cannot change container ID"));
        }
        
        if new_config.name != self.config.name {
            return Err(JsValue::from_str("Cannot change container name"));
        }

        self.config = new_config;
        log::info!("📝 컨테이너 설정 업데이트: {}", self.config.name);
        Ok(())
    }

    /// 컨테이너 상태 설정
    pub fn set_state(&mut self, new_state: StateValue) {
        self.state = new_state;
        self.last_accessed = Utc::now();
    }

    /// 헬스 체크
    pub fn health_check(&self) -> bool {
        match self.status {
            ContainerStatus::Running | ContainerStatus::Paused => true,
            _ => false,
        }
    }

    /// 컨테이너 정보 요약
    pub fn get_info(&self) -> Object {
        let info = Object::new();
        
        js_sys::Reflect::set(&info, &"id".into(), &self.config.id.clone().into()).unwrap();
        js_sys::Reflect::set(&info, &"name".into(), &self.config.name.clone().into()).unwrap();
        js_sys::Reflect::set(&info, &"status".into(), &self.status.to_string().into()).unwrap();
        js_sys::Reflect::set(&info, &"memoryUsage".into(), &self.memory_usage.into()).unwrap();
        js_sys::Reflect::set(&info, &"createdAt".into(), &self.created_at.timestamp_millis().into()).unwrap();
        js_sys::Reflect::set(&info, &"lastAccessed".into(), &self.last_accessed.timestamp_millis().into()).unwrap();

        info
    }
} 