use wasm_bindgen::prelude::*;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use chrono::{DateTime, Utc};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryStats {
    pub used: u32,
    pub allocated: u32,
    pub peak: u32,
    pub allocations: u32,
    pub deallocations: u32,
    pub gc_runs: u32,
    pub last_gc: DateTime<Utc>,
}

impl MemoryStats {
    pub fn new(allocated: u32) -> Self {
        MemoryStats {
            used: 0,
            allocated,
            peak: 0,
            allocations: 0,
            deallocations: 0,
            gc_runs: 0,
            last_gc: Utc::now(),
        }
    }

    pub fn update_usage(&mut self, new_used: u32) {
        self.used = new_used;
        if new_used > self.peak {
            self.peak = new_used;
        }
    }

    pub fn record_allocation(&mut self, size: u32) {
        self.allocations += 1;
        self.used += size;
        if self.used > self.peak {
            self.peak = self.used;
        }
    }

    pub fn record_deallocation(&mut self, size: u32) {
        self.deallocations += 1;
        self.used = self.used.saturating_sub(size);
    }

    pub fn record_gc(&mut self) {
        self.gc_runs += 1;
        self.last_gc = Utc::now();
    }

    pub fn utilization(&self) -> f32 {
        if self.allocated > 0 {
            (self.used as f32 / self.allocated as f32) * 100.0
        } else {
            0.0
        }
    }

    pub fn fragmentation_ratio(&self) -> f32 {
        if self.peak > 0 {
            1.0 - (self.used as f32 / self.peak as f32)
        } else {
            0.0
        }
    }
}

#[derive(Debug)]
pub struct MemoryPool {
    pool_id: String,
    total_size: u32,
    used_size: u32,
    blocks: Vec<MemoryBlock>,
    free_blocks: Vec<usize>, // 사용 가능한 블록 인덱스
}

#[derive(Debug, Clone)]
pub struct MemoryBlock {
    offset: u32,
    size: u32,
    is_free: bool,
    allocated_at: DateTime<Utc>,
}

impl MemoryPool {
    pub fn new(pool_id: String, size: u32) -> Self {
        let initial_block = MemoryBlock {
            offset: 0,
            size,
            is_free: true,
            allocated_at: Utc::now(),
        };

        MemoryPool {
            pool_id,
            total_size: size,
            used_size: 0,
            blocks: vec![initial_block],
            free_blocks: vec![0],
        }
    }

    pub fn allocate(&mut self, size: u32) -> Result<u32, JsValue> {
        // First-fit 알고리즘으로 메모리 할당
        let free_blocks_copy = self.free_blocks.clone();
        for &block_idx in &free_blocks_copy {
            if block_idx < self.blocks.len() {
                let should_allocate = {
                    let block = &self.blocks[block_idx];
                    block.is_free && block.size >= size
                };
                
                if should_allocate {
                    let offset = self.blocks[block_idx].offset;
                    let old_size = self.blocks[block_idx].size;
                    
                    // 블록 분할이 필요한 경우
                    if old_size > size {
                        let remaining_block = MemoryBlock {
                            offset: offset + size,
                            size: old_size - size,
                            is_free: true,
                            allocated_at: Utc::now(),
                        };
                        
                        self.blocks[block_idx].size = size;
                        let new_block_idx = self.blocks.len();
                        self.blocks.push(remaining_block);
                        self.free_blocks.push(new_block_idx);
                    }

                    // 블록 할당
                    self.blocks[block_idx].is_free = false;
                    self.blocks[block_idx].allocated_at = Utc::now();
                    self.used_size += size;

                    // free_blocks에서 제거
                    self.free_blocks.retain(|&idx| idx != block_idx);

                    log::debug!("메모리 할당: {}바이트, 오프셋: {}", size, offset);
                    return Ok(offset);
                }
            }
        }

        Err(JsValue::from_str("Out of memory"))
    }

    pub fn deallocate(&mut self, offset: u32) -> Result<(), JsValue> {
        // 해당 오프셋의 블록 찾기
        for (idx, block) in self.blocks.iter_mut().enumerate() {
            if block.offset == offset && !block.is_free {
                block.is_free = true;
                self.used_size = self.used_size.saturating_sub(block.size);
                self.free_blocks.push(idx);

                log::debug!("메모리 해제: {}B @ offset {}", block.size, offset);

                // 인접한 자유 블록들과 병합
                self.coalesce();
                return Ok(());
            }
        }

        Err(JsValue::from_str("Invalid memory address"))
    }

    // 인접한 자유 블록들을 병합
    fn coalesce(&mut self) {
        let mut changed = true;
        while changed {
            changed = false;
            
            for i in 0..self.blocks.len() {
                if !self.blocks[i].is_free {
                    continue;
                }

                for j in (i + 1)..self.blocks.len() {
                    if !self.blocks[j].is_free {
                        continue;
                    }

                    let block_i = &self.blocks[i];
                    let block_j = &self.blocks[j];

                    // 인접한 블록인지 확인
                    if block_i.offset + block_i.size == block_j.offset {
                        // i와 j 병합
                        let new_size = block_i.size + block_j.size;
                        self.blocks[i].size = new_size;
                        
                        // j 제거
                        self.blocks.remove(j);
                        self.free_blocks.retain(|&idx| idx != j);
                        
                        // 인덱스 조정
                        for idx in self.free_blocks.iter_mut() {
                            if *idx > j {
                                *idx -= 1;
                            }
                        }
                        
                        changed = true;
                        break;
                    }
                }
                
                if changed {
                    break;
                }
            }
        }
    }

    pub fn garbage_collect(&mut self) -> u32 {
        let old_blocks = self.blocks.len();
        
        // 사용되지 않는 오래된 블록들 정리
        let cutoff_time = Utc::now() - chrono::Duration::minutes(30);
        
        self.blocks.retain(|block| {
            !block.is_free || block.allocated_at > cutoff_time
        });

        // free_blocks 인덱스 재구성
        self.free_blocks.clear();
        for (idx, block) in self.blocks.iter().enumerate() {
            if block.is_free {
                self.free_blocks.push(idx);
            }
        }

        self.coalesce();
        
        let collected = old_blocks.saturating_sub(self.blocks.len());
        log::debug!("GC: {} 블록 정리됨", collected);
        
        collected as u32
    }

    pub fn get_stats(&self) -> MemoryPoolStats {
        MemoryPoolStats {
            pool_id: self.pool_id.clone(),
            total_size: self.total_size,
            used_size: self.used_size,
            free_size: self.total_size - self.used_size,
            total_blocks: self.blocks.len(),
            free_blocks: self.free_blocks.len(),
            fragmentation: self.calculate_fragmentation(),
        }
    }

    fn calculate_fragmentation(&self) -> f32 {
        if self.free_blocks.is_empty() {
            return 0.0;
        }

        let free_sizes: Vec<u32> = self.free_blocks
            .iter()
            .map(|&idx| self.blocks[idx].size)
            .collect();

        let largest_free = free_sizes.iter().max().unwrap_or(&0);
        let total_free: u32 = free_sizes.iter().sum();

        if total_free > 0 {
            1.0 - (*largest_free as f32 / total_free as f32)
        } else {
            0.0
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct MemoryPoolStats {
    pub pool_id: String,
    pub total_size: u32,
    pub used_size: u32,
    pub free_size: u32,
    pub total_blocks: usize,
    pub free_blocks: usize,
    pub fragmentation: f32,
}

#[derive(Debug)]
pub struct MemoryManager {
    container_pools: HashMap<String, MemoryPool>,
    container_stats: HashMap<String, MemoryStats>,
    global_limit: u32,
    total_allocated: u32,
    gc_threshold: f32, // GC 실행 임계값 (메모리 사용률 %)
    auto_gc_enabled: bool,
}

impl MemoryManager {
    pub fn new() -> Self {
        MemoryManager {
            container_pools: HashMap::new(),
            container_stats: HashMap::new(),
            global_limit: 512 * 1024 * 1024, // 512MB 전역 한계
            total_allocated: 0,
            gc_threshold: 80.0, // 80% 사용 시 GC 실행
            auto_gc_enabled: true,
        }
    }

    /// 컨테이너용 메모리 할당
    pub fn allocate_container(&mut self, container_id: &str, size: u32) -> Result<(), JsValue> {
        // 전역 메모리 한계 확인
        if self.total_allocated + size > self.global_limit {
            return Err(JsValue::from_str("Global memory limit exceeded"));
        }

        log::info!("💾 메모리 할당: {} ({}MB)", container_id, size / (1024 * 1024));

        // 메모리 풀 생성
        let pool = MemoryPool::new(container_id.to_string(), size);
        self.container_pools.insert(container_id.to_string(), pool);

        // 통계 초기화
        let stats = MemoryStats::new(size);
        self.container_stats.insert(container_id.to_string(), stats);

        self.total_allocated += size;

        // 자동 GC 확인
        if self.auto_gc_enabled {
            self.check_gc_trigger();
        }

        Ok(())
    }

    /// 컨테이너 메모리 해제
    pub fn deallocate_container(&mut self, container_id: &str) {
        log::info!("🗑️ 메모리 해제: {}", container_id);

        if let Some(pool) = self.container_pools.remove(container_id) {
            self.total_allocated = self.total_allocated.saturating_sub(pool.total_size);
        }

        self.container_stats.remove(container_id);
    }

    /// 컨테이너 내 메모리 블록 할당
    pub fn allocate_block(&mut self, container_id: &str, size: u32) -> Result<u32, JsValue> {
        if let Some(pool) = self.container_pools.get_mut(container_id) {
            let offset = pool.allocate(size)?;
            
            // 통계 업데이트
            if let Some(stats) = self.container_stats.get_mut(container_id) {
                stats.record_allocation(size);
            }

            return Ok(offset);
        }

        Err(JsValue::from_str("Container not found"))
    }

    /// 컨테이너 내 메모리 블록 해제
    pub fn deallocate_block(&mut self, container_id: &str, offset: u32) -> Result<(), JsValue> {
        if let Some(pool) = self.container_pools.get_mut(container_id) {
            // 해제할 블록 크기 찾기
            let block_size = pool.blocks
                .iter()
                .find(|block| block.offset == offset && !block.is_free)
                .map(|block| block.size)
                .unwrap_or(0);

            pool.deallocate(offset)?;

            // 통계 업데이트
            if let Some(stats) = self.container_stats.get_mut(container_id) {
                stats.record_deallocation(block_size);
            }

            return Ok(());
        }

        Err(JsValue::from_str("Container not found"))
    }

    /// 컨테이너 메모리 사용량 업데이트
    pub fn update_container_usage(&mut self, container_id: &str, used: u32) {
        if let Some(stats) = self.container_stats.get_mut(container_id) {
            stats.update_usage(used);
        }
    }

    /// 특정 컨테이너 가비지 컬렉션
    pub fn gc_container(&mut self, container_id: &str) -> Result<u32, JsValue> {
        let mut collected = 0;

        if let Some(pool) = self.container_pools.get_mut(container_id) {
            collected = pool.garbage_collect();
        }

        if let Some(stats) = self.container_stats.get_mut(container_id) {
            stats.record_gc();
        }

        log::info!("🧹 GC 완료: {} ({} 블록 정리)", container_id, collected);
        Ok(collected)
    }

    /// 전체 가비지 컬렉션
    pub fn garbage_collect(&mut self) -> u32 {
        log::info!("🧹 전역 GC 시작");

        let mut total_collected = 0;
        let container_ids: Vec<String> = self.container_pools.keys().cloned().collect();

        for container_id in container_ids {
            if let Ok(collected) = self.gc_container(&container_id) {
                total_collected += collected;
            }
        }

        log::info!("✅ 전역 GC 완료: {} 블록 정리됨", total_collected);
        total_collected
    }

    /// GC 트리거 조건 확인
    fn check_gc_trigger(&mut self) {
        let usage_ratio = if self.global_limit > 0 {
            (self.total_allocated as f32 / self.global_limit as f32) * 100.0
        } else {
            0.0
        };

        if usage_ratio > self.gc_threshold {
            log::warn!("⚠️ 메모리 사용률 {}% - GC 실행", usage_ratio as u32);
            self.garbage_collect();
        }
    }

    /// 컨테이너 메모리 통계 조회
    pub fn get_container_stats(&self, container_id: &str) -> Option<&MemoryStats> {
        self.container_stats.get(container_id)
    }

    /// 메모리 풀 통계 조회
    pub fn get_pool_stats(&self, container_id: &str) -> Option<MemoryPoolStats> {
        self.container_pools.get(container_id).map(|pool| pool.get_stats())
    }

    /// 전역 메모리 통계
    pub fn get_global_stats(&self) -> GlobalMemoryStats {
        let total_used: u32 = self.container_stats.values().map(|s| s.used).sum();
        let total_peak: u32 = self.container_stats.values().map(|s| s.peak).sum();
        let total_allocations: u32 = self.container_stats.values().map(|s| s.allocations).sum();
        let total_deallocations: u32 = self.container_stats.values().map(|s| s.deallocations).sum();
        let total_gc_runs: u32 = self.container_stats.values().map(|s| s.gc_runs).sum();

        GlobalMemoryStats {
            total_allocated: self.total_allocated,
            total_used,
            total_peak,
            global_limit: self.global_limit,
            container_count: self.container_pools.len(),
            total_allocations,
            total_deallocations,
            total_gc_runs,
            usage_ratio: if self.global_limit > 0 {
                (self.total_allocated as f32 / self.global_limit as f32) * 100.0
            } else {
                0.0
            },
            average_utilization: if !self.container_stats.is_empty() {
                self.container_stats.values().map(|s| s.utilization()).sum::<f32>() 
                    / self.container_stats.len() as f32
            } else {
                0.0
            },
        }
    }

    /// 메모리 누수 감지
    pub fn detect_leaks(&self) -> Vec<MemoryLeakReport> {
        let mut reports = Vec::new();
        let leak_threshold = chrono::Duration::hours(1);

        for (container_id, stats) in &self.container_stats {
            // 할당/해제 비율이 불균형한 경우
            if stats.allocations > 0 && stats.deallocations > 0 {
                let allocation_ratio = stats.allocations as f32 / stats.deallocations as f32;
                
                if allocation_ratio > 2.0 { // 할당이 해제의 2배 이상
                    reports.push(MemoryLeakReport {
                        container_id: container_id.clone(),
                        leak_type: LeakType::AllocationImbalance,
                        severity: if allocation_ratio > 10.0 { LeakSeverity::High } else { LeakSeverity::Medium },
                        description: format!("할당/해제 비율: {:.2}", allocation_ratio),
                        suggested_action: "메모리 해제 로직 확인 필요".to_string(),
                    });
                }
            }

            // 메모리 사용량이 지속적으로 증가하는 경우
            if stats.used > stats.allocated / 2 && stats.utilization() > 90.0 {
                reports.push(MemoryLeakReport {
                    container_id: container_id.clone(),
                    leak_type: LeakType::HighUtilization,
                    severity: LeakSeverity::Medium,
                    description: format!("메모리 사용률: {:.1}%", stats.utilization()),
                    suggested_action: "GC 실행 또는 메모리 한계 증가 고려".to_string(),
                });
            }

            // 장시간 GC가 실행되지 않은 경우
            if Utc::now() - stats.last_gc > leak_threshold && stats.used > 0 {
                reports.push(MemoryLeakReport {
                    container_id: container_id.clone(),
                    leak_type: LeakType::NoRecentGC,
                    severity: LeakSeverity::Low,
                    description: format!("마지막 GC: {:?}", stats.last_gc),
                    suggested_action: "수동 GC 실행 권장".to_string(),
                });
            }
        }

        reports
    }

    /// 메모리 정리
    pub fn cleanup(&mut self) {
        log::info!("🧹 메모리 관리자 정리");

        self.container_pools.clear();
        self.container_stats.clear();
        self.total_allocated = 0;

        log::info!("✅ 메모리 관리자 정리 완료");
    }

    /// 메모리 한계 설정
    pub fn set_global_limit(&mut self, limit: u32) {
        self.global_limit = limit;
        log::info!("📏 전역 메모리 한계 설정: {}MB", limit / (1024 * 1024));
    }

    /// GC 설정
    pub fn configure_gc(&mut self, threshold: f32, auto_enabled: bool) {
        self.gc_threshold = threshold.clamp(10.0, 95.0);
        self.auto_gc_enabled = auto_enabled;
        log::info!("⚙️ GC 설정: 임계값 {}%, 자동 {}", self.gc_threshold, auto_enabled);
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GlobalMemoryStats {
    pub total_allocated: u32,
    pub total_used: u32,
    pub total_peak: u32,
    pub global_limit: u32,
    pub container_count: usize,
    pub total_allocations: u32,
    pub total_deallocations: u32,
    pub total_gc_runs: u32,
    pub usage_ratio: f32,
    pub average_utilization: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryLeakReport {
    pub container_id: String,
    pub leak_type: LeakType,
    pub severity: LeakSeverity,
    pub description: String,
    pub suggested_action: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum LeakType {
    AllocationImbalance,
    HighUtilization,
    NoRecentGC,
    FragmentationHigh,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum LeakSeverity {
    Low,
    Medium,
    High,
    Critical,
} 