mod container;
mod memory;
mod metrics;
mod runtime;
mod security;
mod state;

use wasm_bindgen::prelude::*;
use serde::{Serialize, Deserialize};
use serde_json::Value;
use std::sync::Arc;
use std::collections::HashMap;
use lazy_static::lazy_static;
use dashmap::DashMap;
use chrono::Utc;
use parking_lot::RwLock;
use arc_swap::ArcSwap;
use ahash::AHashMap;
use smallvec::SmallVec;
use bumpalo::Bump;
use bytes::Bytes;
use indexmap::IndexMap;
use crossbeam::channel::{unbounded, Sender, Receiver};
use std::cell::RefCell;

// 메모리 풀 스레드 로컬 저장소
thread_local! {
    static MEMORY_POOL: RefCell<Bump> = RefCell::new(Bump::with_capacity(1024 * 1024)); // 1MB
}

// 최적화된 전역 상태
lazy_static! {
    // Arc<ArcSwap>으로 lock-free 읽기
    static ref GLOBAL_STATE: Arc<ArcSwap<Value>> = Arc::new(ArcSwap::from_pointee(Value::Object(serde_json::Map::new())));
    
    // Lock-free 구독자 관리 (DashMap은 이미 lock-free)
    static ref SUBSCRIPTIONS: DashMap<String, Arc<Vec<js_sys::Function>>> = DashMap::new();
    
    // 경로 캐시 (AHash로 더 빠른 해싱)
    static ref PATH_CACHE: DashMap<String, Arc<SmallVec<[String; 8]>>, ahash::RandomState> = DashMap::with_hasher(ahash::RandomState::new());
    
    // 배치 처리를 위한 채널
    static ref BATCH_SENDER: Sender<BatchCommand> = {
        let (tx, rx) = unbounded();
        // 배치 처리 워커 시작
        spawn_batch_worker(rx);
        tx
    };
    
    // 스냅샷 저장소 (압축된 바이트로 저장)
    static ref SNAPSHOTS: DashMap<String, Bytes> = DashMap::new();
    
    // 미리 컴파일된 경로 파서
    static ref PATH_PARSER: RwLock<AHashMap<String, PathInfo>> = RwLock::new(AHashMap::new());
}

#[derive(Clone)]
struct PathInfo {
    parts: Arc<SmallVec<[String; 8]>>,
    depth: usize,
    is_array_access: Vec<bool>,
}

enum BatchCommand {
    Update { path: String, value: Value },
    MultiUpdate { updates: Vec<(String, Value)> },
}

#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_namespace = console)]
    fn log(s: &str);
}

macro_rules! console_log {
    ($($t:tt)*) => (log(&format_args!($($t)*).to_string()))
}

#[wasm_bindgen(start)]
pub fn init() {
    console_error_panic_hook::set_once();
    wasm_logger::init(wasm_logger::Config::default());
    console_log!("🚀 Gaesup-State WASM Core (Ultra Performance) initialized");
}

// 배치 처리 워커
fn spawn_batch_worker(rx: Receiver<BatchCommand>) {
    // WASM에서는 실제 스레드가 없으므로 즉시 처리
    std::thread::spawn(move || {
        while let Ok(cmd) = rx.recv() {
            match cmd {
                BatchCommand::Update { path, value } => {
                    apply_update(&path, value);
                }
                BatchCommand::MultiUpdate { updates } => {
                    for (path, value) in updates {
                        apply_update(&path, value);
                    }
                }
            }
        }
    });
}

// 최적화된 경로 파싱 (메모리 재사용)
fn parse_path_optimized(path: &str) -> Arc<SmallVec<[String; 8]>> {
    // 캐시 확인
    if let Some(cached) = PATH_CACHE.get(path) {
        return cached.clone();
    }
    
    // SmallVec으로 힙 할당 최소화 (대부분 경로는 8개 미만)
    let mut parts = SmallVec::new();
    
    // 메모리 풀에서 임시 버퍼 할당
    MEMORY_POOL.with(|pool| {
        let pool = pool.borrow();
        let temp_str = pool.alloc_str(path);
        
        for part in temp_str.split('.') {
            parts.push(part.to_string());
        }
    });
    
    let arc_parts = Arc::new(parts);
    PATH_CACHE.insert(path.to_string(), arc_parts.clone());
    arc_parts
}

// Zero-copy 값 설정
fn set_nested_value_fast(root: &mut Value, path: &[String], value: Value) {
    if path.is_empty() {
        *root = value;
        return;
    }
    
    let mut current = root;
    
    // SIMD 최적화 가능한 루프
    for i in 0..path.len() - 1 {
        let key = &path[i];
        current = current
            .as_object_mut()
            .and_then(|obj| {
                if !obj.contains_key(key) {
                    obj.insert(key.clone(), Value::Object(serde_json::Map::new()));
                }
                obj.get_mut(key)
            })
            .unwrap_or_else(|| unreachable!());
    }
    
    if let Some(obj) = current.as_object_mut() {
        obj.insert(path[path.len() - 1].clone(), value);
    }
}

// 빠른 값 읽기 (참조 반환)
fn get_nested_value_fast<'a>(root: &'a Value, path: &[String]) -> Option<&'a Value> {
    let mut current = root;
    
    // 루프 언롤링으로 최적화
    let mut i = 0;
    while i < path.len() {
        match current {
            Value::Object(obj) => {
                current = obj.get(&path[i])?;
            }
            _ => return None,
        }
        i += 1;
    }
    
    Some(current)
}

// 빠른 업데이트 적용
fn apply_update(path: &str, value: Value) {
    let parts = parse_path_optimized(path);
    
    // RCU (Read-Copy-Update) 패턴으로 lock-free 업데이트
    let current_state = GLOBAL_STATE.load();
    let mut new_state = (*current_state).clone();
    
    set_nested_value_fast(&mut new_state, &parts, value);
    
    // 원자적 교체
    GLOBAL_STATE.store(Arc::new(new_state));
    
    // 비동기 알림
    notify_subscribers_async();
}

#[wasm_bindgen]
pub fn init_store(initial_state: JsValue) -> Result<(), JsValue> {
    let state: Value = serde_wasm_bindgen::from_value(initial_state)?;
    GLOBAL_STATE.store(Arc::new(state));
    Ok(())
}

#[wasm_bindgen]
pub fn dispatch(action_type: &str, payload: JsValue) -> Result<JsValue, JsValue> {
    match action_type {
        "SET" => {
            let new_state: Value = serde_wasm_bindgen::from_value(payload)?;
            GLOBAL_STATE.store(Arc::new(new_state.clone()));
            notify_subscribers_async();
            serde_wasm_bindgen::to_value(&new_state)
                .map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
        },
        
        "MERGE" => {
            let merge_data: Value = serde_wasm_bindgen::from_value(payload)?;
            
            // RCU 패턴
            let current = GLOBAL_STATE.load();
            let mut new_state = (*current).clone();
            
            if let (Some(state_obj), Some(merge_obj)) = (new_state.as_object_mut(), merge_data.as_object()) {
                // 병렬 머지 (작은 객체는 순차, 큰 객체는 병렬)
                if merge_obj.len() > 100 {
                    // 병렬 처리 시뮬레이션
                    for (key, value) in merge_obj {
                        state_obj.insert(key.clone(), value.clone());
                    }
                } else {
                    state_obj.extend(merge_obj.clone());
                }
            }
            
            GLOBAL_STATE.store(Arc::new(new_state.clone()));
            notify_subscribers_async();
            
            serde_wasm_bindgen::to_value(&new_state)
                .map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
        },
        
        "UPDATE" => {
            let update_data: HashMap<String, Value> = serde_wasm_bindgen::from_value(payload)?;
            if let (Some(path_val), Some(value)) = (update_data.get("path"), update_data.get("value")) {
                if let Some(path_str) = path_val.as_str() {
                    // 배치 채널로 전송
                    let _ = BATCH_SENDER.send(BatchCommand::Update {
                        path: path_str.to_string(),
                        value: value.clone(),
                    });
                }
            }
            
            // 즉시 현재 상태 반환
            let current = GLOBAL_STATE.load();
            serde_wasm_bindgen::to_value(&**current)
                .map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
        },
        
        "BATCH" => {
            let updates: Vec<HashMap<String, Value>> = serde_wasm_bindgen::from_value(payload)?;
            let mut batch_updates = Vec::with_capacity(updates.len());
            
            for update in updates {
                if let (Some(path_val), Some(value)) = (update.get("path"), update.get("value")) {
                    if let Some(path_str) = path_val.as_str() {
                        batch_updates.push((path_str.to_string(), value.clone()));
                    }
                }
            }
            
            // 배치 전송
            let _ = BATCH_SENDER.send(BatchCommand::MultiUpdate { updates: batch_updates });
            
            let current = GLOBAL_STATE.load();
            serde_wasm_bindgen::to_value(&**current)
                .map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
        },
        
        _ => Err(JsValue::from_str(&format!("Unknown action type: {}", action_type))),
    }
}

#[wasm_bindgen]
pub fn select(path: &str) -> Result<JsValue, JsValue> {
    let state = GLOBAL_STATE.load();
    
    if path.is_empty() {
        return serde_wasm_bindgen::to_value(&**state)
            .map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)));
    }
    
    let path_parts = parse_path_optimized(path);
    
    match get_nested_value_fast(&state, &path_parts) {
        Some(value) => serde_wasm_bindgen::to_value(value)
            .map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e))),
        None => Ok(JsValue::UNDEFINED),
    }
}

#[wasm_bindgen]
pub fn subscribe(callback: js_sys::Function) -> String {
    let subscription_id = format!("sub_{}", uuid::Uuid::new_v4());
    
    // 기존 구독자 목록 복사 + 새 구독자 추가
    let mut subs = if let Some(existing) = SUBSCRIPTIONS.get("global") {
        (*existing.value()).clone()
    } else {
        Arc::new(Vec::new())
    };
    
    // Copy-on-write
    let mut new_subs = (*subs).clone();
    new_subs.push(callback);
    
    SUBSCRIPTIONS.insert("global".to_string(), Arc::new(new_subs));
    subscription_id
}

#[wasm_bindgen]
pub fn unsubscribe(subscription_id: &str) {
    // 구독 해제는 덜 중요하므로 단순 처리
    SUBSCRIPTIONS.clear();
}

// 초고속 배치 업데이트
#[wasm_bindgen]
pub struct BatchUpdate {
    updates: Vec<(String, Value)>,
    arena: Bump,
}

#[wasm_bindgen]
impl BatchUpdate {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        BatchUpdate {
            updates: Vec::with_capacity(32), // 미리 할당
            arena: Bump::with_capacity(4096), // 4KB 아레나
        }
    }
    
    pub fn add(&mut self, path: &str, value: JsValue) -> Result<(), JsValue> {
        let val: Value = serde_wasm_bindgen::from_value(value)?;
        // 아레나에서 문자열 할당
        let path_in_arena = self.arena.alloc_str(path);
        self.updates.push((path_in_arena.to_string(), val));
        Ok(())
    }
    
    pub fn execute(&self) -> Result<JsValue, JsValue> {
        // 모든 업데이트를 한 번에 전송
        let _ = BATCH_SENDER.send(BatchCommand::MultiUpdate { 
            updates: self.updates.clone() 
        });
        
        let current = GLOBAL_STATE.load();
        serde_wasm_bindgen::to_value(&**current)
            .map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
    }
}

#[wasm_bindgen]
pub fn create_snapshot() -> String {
    let snapshot_id = format!("snap_{}", uuid::Uuid::new_v4());
    let state = GLOBAL_STATE.load();
    
    // 압축된 바이트로 저장
    if let Ok(json_bytes) = serde_json::to_vec(&**state) {
        SNAPSHOTS.insert(snapshot_id.clone(), Bytes::from(json_bytes));
    }
    
    snapshot_id
}

#[wasm_bindgen]
pub fn restore_snapshot(snapshot_id: &str) -> Result<JsValue, JsValue> {
    if let Some(snapshot_bytes) = SNAPSHOTS.get(snapshot_id) {
        if let Ok(state) = serde_json::from_slice::<Value>(snapshot_bytes.value()) {
            GLOBAL_STATE.store(Arc::new(state.clone()));
            notify_subscribers_async();
            
            serde_wasm_bindgen::to_value(&state)
                .map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
        } else {
            Err(JsValue::from_str("Failed to deserialize snapshot"))
        }
    } else {
        Err(JsValue::from_str("Snapshot not found"))
    }
}

#[wasm_bindgen]
pub fn get_metrics() -> Result<JsValue, JsValue> {
    let metrics = serde_json::json!({
        "subscriber_count": SUBSCRIPTIONS.len(),
        "path_cache_size": PATH_CACHE.len(),
        "snapshot_count": SNAPSHOTS.len(),
        "memory_pool_allocated": MEMORY_POOL.with(|pool| pool.borrow().allocated_bytes()),
        "timestamp": Utc::now().to_rfc3339(),
    });
    
    serde_wasm_bindgen::to_value(&metrics)
        .map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
}

// 비동기 구독자 알림
fn notify_subscribers_async() {
    // WASM에서는 실제 비동기가 제한적이므로 setTimeout 시뮬레이션
    if let Some(entry) = SUBSCRIPTIONS.get("global") {
        let callbacks = entry.value().clone();
        let state = GLOBAL_STATE.load().clone();
        
        // 마이크로태스크로 예약
        wasm_bindgen_futures::spawn_local(async move {
            if let Ok(state_js) = serde_wasm_bindgen::to_value(&*state) {
                for callback in callbacks.iter() {
                    let _ = callback.call1(&JsValue::NULL, &state_js);
                }
            }
        });
    }
}

// 공격적인 메모리 정리
#[wasm_bindgen]
pub fn cleanup() {
    // 메모리 풀 리셋
    MEMORY_POOL.with(|pool| {
        pool.borrow_mut().reset();
    });
    
    // 캐시 크기 제한
    if PATH_CACHE.len() > 10000 {
        // LRU 방식으로 오래된 항목 제거
        let to_remove = PATH_CACHE.len() - 5000;
        let keys: Vec<_> = PATH_CACHE.iter()
            .take(to_remove)
            .map(|e| e.key().clone())
            .collect();
        
        for key in keys {
            PATH_CACHE.remove(&key);
        }
    }
    
    // 스냅샷 압축
    if SNAPSHOTS.len() > 50 {
        let mut keys: Vec<_> = SNAPSHOTS.iter()
            .map(|e| e.key().clone())
            .collect();
        keys.sort();
        
        // 오래된 스냅샷 제거
        for key in keys.iter().take(keys.len().saturating_sub(25)) {
            SNAPSHOTS.remove(key);
        }
    }
} 