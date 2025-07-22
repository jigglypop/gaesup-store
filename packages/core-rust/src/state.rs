use wasm_bindgen::prelude::*;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use chrono::{DateTime, Utc};

use crate::JSContainerState;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum StateValue {
    Object(JSContainerState),
    String(String),
    Number(f64),
    Boolean(bool),
    Array(Vec<StateValue>),
    Map(HashMap<String, StateValue>),
    Null,
}

impl StateValue {
    /// 상태 값 압축
    pub fn compress(&self) -> Vec<u8> {
        // 간단한 압축 (실제로는 더 복잡한 압축 알고리즘 사용)
        match serde_json::to_vec(self) {
            Ok(data) => data,
            Err(_) => vec![],
        }
    }

    /// 압축된 데이터에서 상태 복원
    pub fn decompress(data: &[u8]) -> Result<StateValue, JsValue> {
        match serde_json::from_slice(data) {
            Ok(value) => Ok(value),
            Err(e) => Err(JsValue::from_str(&e.to_string())),
        }
    }

    /// 상태 병합
    pub fn merge(&mut self, other: &StateValue) {
        match (self.clone(), other) {
            (StateValue::Object(mut s), StateValue::Object(o)) => {
                s.count = o.count;
                s.last_updated = o.last_updated;
                s.framework = o.framework.clone();
                *self = StateValue::Object(s);
            }
            (StateValue::Map(mut s), StateValue::Map(o)) => {
                for (k, v) in o.iter() {
                    s.insert(k.clone(), v.clone());
                }
                *self = StateValue::Map(s);
            }
            _ => {
                *self = other.clone();
            }
        }
    }

    /// 상태 비교
    pub fn equals(&self, other: &StateValue) -> bool {
        match (self, other) {
            (StateValue::Object(s), StateValue::Object(o)) => {
                s.count == o.count && s.framework == o.framework
            }
            (StateValue::String(s), StateValue::String(o)) => s == o,
            (StateValue::Number(s), StateValue::Number(o)) => s == o,
            (StateValue::Boolean(s), StateValue::Boolean(o)) => s == o,
            (StateValue::Null, StateValue::Null) => true,
            _ => false,
        }
    }

    /// 상태 크기 계산 (바이트)
    pub fn size(&self) -> usize {
        match self {
            StateValue::Object(_) => std::mem::size_of::<JSContainerState>(),
            StateValue::String(s) => s.len(),
            StateValue::Number(_) => 8,
            StateValue::Boolean(_) => 1,
            StateValue::Array(arr) => arr.iter().map(|v| v.size()).sum::<usize>() + 24,
            StateValue::Map(map) => {
                map.iter()
                    .map(|(k, v)| k.len() + v.size())
                    .sum::<usize>() + 24
            }
            StateValue::Null => 0,
        }
    }
}

#[derive(Debug)]
pub struct StateSnapshot {
    pub container_id: String,
    pub state: StateValue,
    pub timestamp: DateTime<Utc>,
    pub version: u32,
    pub compressed_data: Vec<u8>,
}

impl StateSnapshot {
    pub fn new(container_id: String, state: StateValue) -> Self {
        let compressed_data = state.compress();
        
        StateSnapshot {
            container_id,
            timestamp: Utc::now(),
            version: 1,
            compressed_data,
            state,
        }
    }

    pub fn size(&self) -> usize {
        self.compressed_data.len()
    }
}

#[derive(Debug)]
pub struct StateHistory {
    snapshots: Vec<StateSnapshot>,
    max_snapshots: usize,
    total_size: usize,
    max_size: usize, // 최대 히스토리 크기 (바이트)
}

impl StateHistory {
    pub fn new(max_snapshots: usize, max_size: usize) -> Self {
        StateHistory {
            snapshots: Vec::new(),
            max_snapshots,
            total_size: 0,
            max_size,
        }
    }

    pub fn add_snapshot(&mut self, snapshot: StateSnapshot) {
        self.total_size += snapshot.size();
        self.snapshots.push(snapshot);

        // 오래된 스냅샷 정리
        while self.snapshots.len() > self.max_snapshots || self.total_size > self.max_size {
            if let Some(old_snapshot) = self.snapshots.remove(0) {
                self.total_size = self.total_size.saturating_sub(old_snapshot.size());
            }
        }
    }

    pub fn get_latest(&self) -> Option<&StateSnapshot> {
        self.snapshots.last()
    }

    pub fn get_by_version(&self, version: u32) -> Option<&StateSnapshot> {
        self.snapshots.iter().find(|s| s.version == version)
    }

    pub fn rollback_to_version(&mut self, version: u32) -> Option<StateValue> {
        if let Some(snapshot) = self.get_by_version(version) {
            Some(snapshot.state.clone())
        } else {
            None
        }
    }

    pub fn cleanup(&mut self) {
        // 압축된 데이터만 유지하고 메모리 사용량 최적화
        let cutoff_time = Utc::now() - chrono::Duration::hours(1);
        
        self.snapshots.retain(|snapshot| snapshot.timestamp > cutoff_time);
        self.total_size = self.snapshots.iter().map(|s| s.size()).sum();
    }
}

#[derive(Debug)]
pub struct StateManager {
    container_states: HashMap<String, StateValue>,
    state_history: HashMap<String, StateHistory>,
    state_cache: HashMap<String, Vec<u8>>, // 압축된 상태 캐시
    subscribers: HashMap<String, Vec<String>>, // 컨테이너별 구독자 목록
    total_memory_usage: usize,
    max_memory_usage: usize,
}

impl StateManager {
    pub fn new() -> Self {
        StateManager {
            container_states: HashMap::new(),
            state_history: HashMap::new(),
            state_cache: HashMap::new(),
            subscribers: HashMap::new(),
            total_memory_usage: 0,
            max_memory_usage: 100 * 1024 * 1024, // 100MB
        }
    }

    /// 컨테이너 상태 초기화
    pub fn initialize_container(&mut self, container_id: &str, initial_state: &StateValue) {
        log::info!("🔧 상태 초기화: {}", container_id);

        // 상태 저장
        self.container_states.insert(container_id.to_string(), initial_state.clone());

        // 히스토리 초기화
        let history = StateHistory::new(50, 10 * 1024 * 1024); // 50개 스냅샷, 10MB
        self.state_history.insert(container_id.to_string(), history);

        // 구독자 목록 초기화
        self.subscribers.insert(container_id.to_string(), Vec::new());

        // 초기 스냅샷 생성
        self.create_snapshot(container_id, initial_state);

        self.update_memory_usage();
    }

    /// 컨테이너 상태 업데이트
    pub fn update_container(&mut self, container_id: &str, new_state: &StateValue) {
        log::debug!("📝 상태 업데이트: {}", container_id);

        if let Some(current_state) = self.container_states.get_mut(container_id) {
            // 상태가 실제로 변경되었는지 확인
            if !current_state.equals(new_state) {
                *current_state = new_state.clone();

                // 스냅샷 생성
                self.create_snapshot(container_id, new_state);

                // 캐시 업데이트
                self.update_cache(container_id, new_state);

                // 구독자들에게 알림 (실제 구현에서는 이벤트 발생)
                self.notify_subscribers(container_id, new_state);

                self.update_memory_usage();
            }
        }
    }

    /// 컨테이너 상태 조회
    pub fn get_container_state(&self, container_id: &str) -> Option<&StateValue> {
        self.container_states.get(container_id)
    }

    /// 컨테이너 제거
    pub fn remove_container(&mut self, container_id: &str) {
        log::info!("🗑️ 상태 제거: {}", container_id);

        self.container_states.remove(container_id);
        self.state_history.remove(container_id);
        self.state_cache.remove(container_id);
        self.subscribers.remove(container_id);

        self.update_memory_usage();
    }

    /// 상태 스냅샷 생성
    fn create_snapshot(&mut self, container_id: &str, state: &StateValue) {
        if let Some(history) = self.state_history.get_mut(container_id) {
            let snapshot = StateSnapshot::new(container_id.to_string(), state.clone());
            history.add_snapshot(snapshot);
        }
    }

    /// 캐시 업데이트
    fn update_cache(&mut self, container_id: &str, state: &StateValue) {
        let compressed = state.compress();
        self.state_cache.insert(container_id.to_string(), compressed);
    }

    /// 구독자에게 알림
    fn notify_subscribers(&self, container_id: &str, new_state: &StateValue) {
        if let Some(subscribers) = self.subscribers.get(container_id) {
            log::debug!("📢 {}명의 구독자에게 알림: {}", subscribers.len(), container_id);
            // 실제 구현에서는 여기서 이벤트를 발생시킴
        }
    }

    /// 구독자 추가
    pub fn subscribe(&mut self, container_id: &str, subscriber_id: &str) {
        if let Some(subscribers) = self.subscribers.get_mut(container_id) {
            if !subscribers.contains(&subscriber_id.to_string()) {
                subscribers.push(subscriber_id.to_string());
                log::debug!("📝 구독자 추가: {} -> {}", subscriber_id, container_id);
            }
        }
    }

    /// 구독자 제거
    pub fn unsubscribe(&mut self, container_id: &str, subscriber_id: &str) {
        if let Some(subscribers) = self.subscribers.get_mut(container_id) {
            subscribers.retain(|s| s != subscriber_id);
            log::debug!("🗑️ 구독자 제거: {} -> {}", subscriber_id, container_id);
        }
    }

    /// 상태 히스토리 조회
    pub fn get_state_history(&self, container_id: &str) -> Option<&StateHistory> {
        self.state_history.get(container_id)
    }

    /// 특정 버전으로 롤백
    pub fn rollback_to_version(&mut self, container_id: &str, version: u32) -> Result<(), JsValue> {
        if let Some(history) = self.state_history.get_mut(container_id) {
            if let Some(old_state) = history.rollback_to_version(version) {
                self.container_states.insert(container_id.to_string(), old_state.clone());
                self.update_cache(container_id, &old_state);
                log::info!("⏪ 상태 롤백 완료: {} (버전 {})", container_id, version);
                Ok(())
            } else {
                Err(JsValue::from_str("Version not found"))
            }
        } else {
            Err(JsValue::from_str("Container not found"))
        }
    }

    /// 상태 압축 실행
    pub fn compress(&mut self) {
        log::info!("🗜️ 상태 압축 시작");

        let mut compressed_count = 0;
        let mut saved_bytes = 0;

        // 모든 히스토리 정리
        for (container_id, history) in self.state_history.iter_mut() {
            let old_size = history.total_size;
            history.cleanup();
            let new_size = history.total_size;
            
            saved_bytes += old_size.saturating_sub(new_size);
            compressed_count += 1;
        }

        // 오래된 캐시 엔트리 정리
        let cutoff_time = Utc::now() - chrono::Duration::minutes(30);
        let cache_keys: Vec<String> = self.state_cache.keys().cloned().collect();
        
        for key in cache_keys {
            // 최근에 사용되지 않은 캐시 제거 (간단한 구현)
            if self.container_states.get(&key).is_none() {
                self.state_cache.remove(&key);
            }
        }

        self.update_memory_usage();

        log::info!(
            "✅ 상태 압축 완료: {} 컨테이너, {}KB 절약",
            compressed_count,
            saved_bytes / 1024
        );
    }

    /// 메모리 사용량 업데이트
    fn update_memory_usage(&mut self) {
        let states_size: usize = self.container_states.values().map(|s| s.size()).sum();
        let cache_size: usize = self.state_cache.values().map(|c| c.len()).sum();
        let history_size: usize = self.state_history.values().map(|h| h.total_size).sum();

        self.total_memory_usage = states_size + cache_size + history_size;

        // 메모리 사용량이 한계에 도달하면 정리
        if self.total_memory_usage > self.max_memory_usage {
            log::warn!(
                "⚠️ 메모리 사용량 한계 도달: {}MB / {}MB",
                self.total_memory_usage / (1024 * 1024),
                self.max_memory_usage / (1024 * 1024)
            );
            self.emergency_cleanup();
        }
    }

    /// 응급 메모리 정리
    fn emergency_cleanup(&mut self) {
        log::warn!("🚨 응급 메모리 정리 시작");

        // 가장 오래된 히스토리부터 정리
        let mut containers_by_age: Vec<(String, DateTime<Utc>)> = self.state_history
            .iter()
            .filter_map(|(id, history)| {
                history.get_latest().map(|snapshot| (id.clone(), snapshot.timestamp))
            })
            .collect();

        containers_by_age.sort_by(|a, b| a.1.cmp(&b.1));

        // 오래된 컨테이너의 히스토리 정리
        for (container_id, _) in containers_by_age.iter().take(5) {
            if let Some(history) = self.state_history.get_mut(container_id) {
                let old_len = history.snapshots.len();
                history.snapshots.truncate(old_len / 2); // 절반으로 줄임
                history.total_size = history.snapshots.iter().map(|s| s.size()).sum();
            }
        }

        // 캐시 정리
        if self.state_cache.len() > 10 {
            let cache_keys: Vec<String> = self.state_cache.keys().take(5).cloned().collect();
            for key in cache_keys {
                self.state_cache.remove(&key);
            }
        }

        self.update_memory_usage();
        log::warn!("✅ 응급 메모리 정리 완료");
    }

    /// 상태 관리자 통계
    pub fn get_stats(&self) -> StateManagerStats {
        StateManagerStats {
            total_containers: self.container_states.len(),
            total_memory_usage: self.total_memory_usage,
            cache_entries: self.state_cache.len(),
            total_subscribers: self.subscribers.values().map(|s| s.len()).sum(),
            total_snapshots: self.state_history.values().map(|h| h.snapshots.len()).sum(),
        }
    }

    /// 전체 정리
    pub fn cleanup(&mut self) {
        log::info!("🧹 상태 관리자 정리");

        self.container_states.clear();
        self.state_history.clear();
        self.state_cache.clear();
        self.subscribers.clear();
        self.total_memory_usage = 0;

        log::info!("✅ 상태 관리자 정리 완료");
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct StateManagerStats {
    pub total_containers: usize,
    pub total_memory_usage: usize,
    pub cache_entries: usize,
    pub total_subscribers: usize,
    pub total_snapshots: usize,
} 