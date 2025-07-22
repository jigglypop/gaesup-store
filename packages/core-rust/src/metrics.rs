use wasm_bindgen::prelude::*;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, VecDeque};
use chrono::{DateTime, Utc, Duration};
use web_sys::{window, Performance};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PerformanceMetrics {
    pub function_calls: u32,
    pub avg_execution_time: f64,
    pub min_execution_time: f64,
    pub max_execution_time: f64,
    pub total_execution_time: f64,
    pub last_gc: f64,
    pub errors: u32,
    pub success_rate: f32,
    pub throughput: f32, // calls per second
    pub memory_pressure: f32,
    pub cpu_utilization: f32,
}

impl PerformanceMetrics {
    pub fn new() -> Self {
        PerformanceMetrics {
            function_calls: 0,
            avg_execution_time: 0.0,
            min_execution_time: f64::MAX,
            max_execution_time: 0.0,
            total_execution_time: 0.0,
            last_gc: 0.0,
            errors: 0,
            success_rate: 100.0,
            throughput: 0.0,
            memory_pressure: 0.0,
            cpu_utilization: 0.0,
        }
    }

    pub fn record_execution(&mut self, execution_time: f64, success: bool) {
        self.function_calls += 1;
        
        if success {
            self.total_execution_time += execution_time;
            self.avg_execution_time = self.total_execution_time / self.function_calls as f64;
            
            if execution_time < self.min_execution_time {
                self.min_execution_time = execution_time;
            }
            
            if execution_time > self.max_execution_time {
                self.max_execution_time = execution_time;
            }
        } else {
            self.errors += 1;
        }

        // 성공률 계산
        let successes = self.function_calls - self.errors;
        self.success_rate = (successes as f32 / self.function_calls as f32) * 100.0;
    }

    pub fn update_throughput(&mut self, time_window_seconds: f64) {
        if time_window_seconds > 0.0 {
            self.throughput = self.function_calls as f32 / time_window_seconds as f32;
        }
    }

    pub fn update_resource_usage(&mut self, memory_pressure: f32, cpu_utilization: f32) {
        self.memory_pressure = memory_pressure.clamp(0.0, 100.0);
        self.cpu_utilization = cpu_utilization.clamp(0.0, 100.0);
    }

    pub fn record_gc(&mut self) {
        self.last_gc = get_current_time();
    }

    pub fn reset(&mut self) {
        *self = PerformanceMetrics::new();
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MetricSample {
    pub timestamp: f64,
    pub value: f64,
    pub metadata: HashMap<String, String>,
}

impl MetricSample {
    pub fn new(value: f64) -> Self {
        MetricSample {
            timestamp: get_current_time(),
            value,
            metadata: HashMap::new(),
        }
    }

    pub fn with_metadata(mut self, key: &str, value: &str) -> Self {
        self.metadata.insert(key.to_string(), value.to_string());
        self
    }
}

#[derive(Debug)]
pub struct TimeSeries {
    samples: VecDeque<MetricSample>,
    max_samples: usize,
    retention_duration: Duration,
}

impl TimeSeries {
    pub fn new(max_samples: usize, retention_hours: i64) -> Self {
        TimeSeries {
            samples: VecDeque::new(),
            max_samples,
            retention_duration: Duration::hours(retention_hours),
        }
    }

    pub fn add_sample(&mut self, sample: MetricSample) {
        self.samples.push_back(sample);
        
        // 최대 샘플 수 제한
        while self.samples.len() > self.max_samples {
            self.samples.pop_front();
        }

        // 보존 기간 기준으로 정리
        self.cleanup_old_samples();
    }

    fn cleanup_old_samples(&mut self) {
        let cutoff_time = get_current_time() - self.retention_duration.num_milliseconds() as f64;
        
        while let Some(front) = self.samples.front() {
            if front.timestamp < cutoff_time {
                self.samples.pop_front();
            } else {
                break;
            }
        }
    }

    pub fn get_latest(&self) -> Option<&MetricSample> {
        self.samples.back()
    }

    pub fn get_samples(&self) -> &VecDeque<MetricSample> {
        &self.samples
    }

    pub fn calculate_average(&self, window_minutes: i64) -> f64 {
        let window_start = get_current_time() - (window_minutes * 60 * 1000) as f64;
        
        let relevant_samples: Vec<f64> = self.samples
            .iter()
            .filter(|s| s.timestamp >= window_start)
            .map(|s| s.value)
            .collect();

        if relevant_samples.is_empty() {
            0.0
        } else {
            relevant_samples.iter().sum::<f64>() / relevant_samples.len() as f64
        }
    }

    pub fn calculate_percentile(&self, percentile: f64) -> f64 {
        if self.samples.is_empty() {
            return 0.0;
        }

        let mut values: Vec<f64> = self.samples.iter().map(|s| s.value).collect();
        values.sort_by(|a, b| a.partial_cmp(b).unwrap());

        let index = ((percentile / 100.0) * (values.len() as f64 - 1.0)).round() as usize;
        values[index.min(values.len() - 1)]
    }

    pub fn detect_anomalies(&self, threshold_multiplier: f64) -> Vec<&MetricSample> {
        if self.samples.len() < 10 {
            return Vec::new();
        }

        let mean = self.calculate_average(60); // 최근 1시간 평균
        let values: Vec<f64> = self.samples.iter().map(|s| s.value).collect();
        
        // 표준편차 계산
        let variance = values.iter()
            .map(|&x| (x - mean).powi(2))
            .sum::<f64>() / values.len() as f64;
        let std_dev = variance.sqrt();

        let threshold = mean + (std_dev * threshold_multiplier);

        self.samples
            .iter()
            .filter(|sample| sample.value > threshold)
            .collect()
    }
}

#[derive(Debug)]
pub struct MetricsCollector {
    container_metrics: HashMap<String, PerformanceMetrics>,
    time_series: HashMap<String, HashMap<String, TimeSeries>>, // container_id -> metric_name -> series
    global_metrics: PerformanceMetrics,
    collection_start: f64,
    alert_thresholds: HashMap<String, f64>,
    monitoring_enabled: bool,
}

impl MetricsCollector {
    pub fn new() -> Self {
        MetricsCollector {
            container_metrics: HashMap::new(),
            time_series: HashMap::new(),
            global_metrics: PerformanceMetrics::new(),
            collection_start: get_current_time(),
            alert_thresholds: Self::default_thresholds(),
            monitoring_enabled: true,
        }
    }

    fn default_thresholds() -> HashMap<String, f64> {
        let mut thresholds = HashMap::new();
        thresholds.insert("execution_time".to_string(), 1000.0); // 1초
        thresholds.insert("memory_pressure".to_string(), 90.0); // 90%
        thresholds.insert("error_rate".to_string(), 5.0); // 5%
        thresholds.insert("cpu_utilization".to_string(), 80.0); // 80%
        thresholds
    }

    pub fn register_container(&mut self, container_id: &str) {
        log::info!("📊 메트릭스 등록: {}", container_id);
        
        self.container_metrics.insert(
            container_id.to_string(),
            PerformanceMetrics::new()
        );

        // 시계열 데이터 초기화
        let mut series_map = HashMap::new();
        series_map.insert("execution_time".to_string(), TimeSeries::new(1000, 24));
        series_map.insert("memory_usage".to_string(), TimeSeries::new(1000, 24));
        series_map.insert("cpu_usage".to_string(), TimeSeries::new(1000, 24));
        series_map.insert("throughput".to_string(), TimeSeries::new(1000, 24));
        series_map.insert("error_rate".to_string(), TimeSeries::new(1000, 24));

        self.time_series.insert(container_id.to_string(), series_map);
    }

    pub fn unregister_container(&mut self, container_id: &str) {
        log::info!("🗑️ 메트릭스 해제: {}", container_id);
        
        self.container_metrics.remove(container_id);
        self.time_series.remove(container_id);
    }

    pub fn record_function_call(
        &mut self, 
        container_id: &str, 
        function_name: &str, 
        execution_time: f64
    ) {
        if !self.monitoring_enabled {
            return;
        }

        let success = execution_time < self.alert_thresholds
            .get("execution_time")
            .unwrap_or(&1000.0);

        // 컨테이너별 메트릭스 업데이트
        if let Some(metrics) = self.container_metrics.get_mut(container_id) {
            metrics.record_execution(execution_time, *success);
            
            // CPU 사용률 추정 (실행 시간 기반)
            let estimated_cpu = (execution_time / 1000.0 * 100.0).min(100.0);
            metrics.cpu_utilization = estimated_cpu as f32;
        }

        // 글로벌 메트릭스 업데이트
        self.global_metrics.record_execution(execution_time, *success);

        // 시계열 데이터 추가
        if let Some(series_map) = self.time_series.get_mut(container_id) {
            if let Some(exec_series) = series_map.get_mut("execution_time") {
                let sample = MetricSample::new(execution_time)
                    .with_metadata("function", function_name)
                    .with_metadata("container", container_id);
                exec_series.add_sample(sample);
            }
        }

        // 임계값 초과 시 경고
        if execution_time > *self.alert_thresholds.get("execution_time").unwrap_or(&1000.0) {
            log::warn!(
                "⚠️ 실행 시간 임계값 초과: {}::{} ({}ms)",
                container_id, function_name, execution_time
            );
        }

        log::debug!(
            "📈 함수 실행 기록: {}::{} ({}ms)",
            container_id, function_name, execution_time
        );
    }

    pub fn record_memory_usage(&mut self, container_id: &str, memory_used: u32, memory_limit: u32) {
        let memory_pressure = if memory_limit > 0 {
            (memory_used as f32 / memory_limit as f32) * 100.0
        } else {
            0.0
        };

        // 컨테이너 메트릭스 업데이트
        if let Some(metrics) = self.container_metrics.get_mut(container_id) {
            metrics.memory_pressure = memory_pressure;
        }

        // 시계열 데이터 추가
        if let Some(series_map) = self.time_series.get_mut(container_id) {
            if let Some(memory_series) = series_map.get_mut("memory_usage") {
                let sample = MetricSample::new(memory_used as f64)
                    .with_metadata("pressure", &memory_pressure.to_string())
                    .with_metadata("limit", &memory_limit.to_string());
                memory_series.add_sample(sample);
            }
        }

        // 메모리 압박 경고
        if memory_pressure > *self.alert_thresholds.get("memory_pressure").unwrap_or(&90.0) {
            log::warn!(
                "⚠️ 메모리 압박: {} ({}%)",
                container_id, memory_pressure as u32
            );
        }
    }

    pub fn record_throughput(&mut self, container_id: &str) {
        let current_time = get_current_time();
        let time_window = (current_time - self.collection_start) / 1000.0; // 초 단위

        if let Some(metrics) = self.container_metrics.get_mut(container_id) {
            metrics.update_throughput(time_window);

            // 시계열 데이터 추가
            if let Some(series_map) = self.time_series.get_mut(container_id) {
                if let Some(throughput_series) = series_map.get_mut("throughput") {
                    let sample = MetricSample::new(metrics.throughput as f64);
                    throughput_series.add_sample(sample);
                }
            }
        }
    }

    pub fn get_container_metrics(&self, container_id: &str) -> Option<&PerformanceMetrics> {
        self.container_metrics.get(container_id)
    }

    pub fn get_global_metrics(&self) -> &PerformanceMetrics {
        &self.global_metrics
    }

    pub fn get_time_series(&self, container_id: &str, metric_name: &str) -> Option<&TimeSeries> {
        self.time_series
            .get(container_id)?
            .get(metric_name)
    }

    pub fn generate_performance_report(&self, container_id: &str) -> Option<PerformanceReport> {
        let metrics = self.container_metrics.get(container_id)?;
        let time_series = self.time_series.get(container_id)?;

        let mut report = PerformanceReport {
            container_id: container_id.to_string(),
            generated_at: get_current_time(),
            metrics: metrics.clone(),
            trends: HashMap::new(),
            alerts: Vec::new(),
            recommendations: Vec::new(),
        };

        // 트렌드 분석
        for (metric_name, series) in time_series {
            let trend = self.analyze_trend(series);
            report.trends.insert(metric_name.clone(), trend);
        }

        // 경고 생성
        self.generate_alerts(&mut report);

        // 권장사항 생성
        self.generate_recommendations(&mut report);

        Some(report)
    }

    fn analyze_trend(&self, series: &TimeSeries) -> TrendAnalysis {
        let samples = series.get_samples();
        
        if samples.len() < 2 {
            return TrendAnalysis {
                direction: TrendDirection::Stable,
                rate_of_change: 0.0,
                confidence: 0.0,
            };
        }

        // 선형 회귀로 트렌드 분석
        let n = samples.len() as f64;
        let sum_x: f64 = (0..samples.len()).map(|i| i as f64).sum();
        let sum_y: f64 = samples.iter().map(|s| s.value).sum();
        let sum_xy: f64 = samples.iter().enumerate()
            .map(|(i, s)| i as f64 * s.value)
            .sum();
        let sum_x2: f64 = (0..samples.len()).map(|i| (i as f64).powi(2)).sum();

        let slope = (n * sum_xy - sum_x * sum_y) / (n * sum_x2 - sum_x.powi(2));
        
        // R² 계산 (신뢰도)
        let mean_y = sum_y / n;
        let ss_tot: f64 = samples.iter().map(|s| (s.value - mean_y).powi(2)).sum();
        let ss_res: f64 = samples.iter().enumerate()
            .map(|(i, s)| {
                let predicted = slope * i as f64 + (sum_y - slope * sum_x) / n;
                (s.value - predicted).powi(2)
            })
            .sum();
        
        let r_squared = 1.0 - (ss_res / ss_tot);

        let direction = if slope > 0.1 {
            TrendDirection::Increasing
        } else if slope < -0.1 {
            TrendDirection::Decreasing
        } else {
            TrendDirection::Stable
        };

        TrendAnalysis {
            direction,
            rate_of_change: slope,
            confidence: r_squared.clamp(0.0, 1.0),
        }
    }

    fn generate_alerts(&self, report: &mut PerformanceReport) {
        let metrics = &report.metrics;

        // 실행 시간 경고
        if metrics.avg_execution_time > *self.alert_thresholds.get("execution_time").unwrap_or(&1000.0) {
            report.alerts.push(Alert {
                level: AlertLevel::Warning,
                message: format!("평균 실행 시간이 {}ms로 임계값을 초과했습니다", metrics.avg_execution_time),
                metric: "execution_time".to_string(),
                value: metrics.avg_execution_time,
                threshold: *self.alert_thresholds.get("execution_time").unwrap_or(&1000.0),
            });
        }

        // 메모리 압박 경고
        if metrics.memory_pressure > *self.alert_thresholds.get("memory_pressure").unwrap_or(&90.0) {
            report.alerts.push(Alert {
                level: AlertLevel::Critical,
                message: format!("메모리 압박이 {}%에 도달했습니다", metrics.memory_pressure),
                metric: "memory_pressure".to_string(),
                value: metrics.memory_pressure as f64,
                threshold: *self.alert_thresholds.get("memory_pressure").unwrap_or(&90.0),
            });
        }

        // 에러율 경고
        let error_rate = 100.0 - metrics.success_rate;
        if error_rate > *self.alert_thresholds.get("error_rate").unwrap_or(&5.0) {
            report.alerts.push(Alert {
                level: AlertLevel::Warning,
                message: format!("에러율이 {}%로 증가했습니다", error_rate),
                metric: "error_rate".to_string(),
                value: error_rate as f64,
                threshold: *self.alert_thresholds.get("error_rate").unwrap_or(&5.0),
            });
        }
    }

    fn generate_recommendations(&self, report: &mut PerformanceReport) {
        let metrics = &report.metrics;

        // 성능 최적화 권장사항
        if metrics.avg_execution_time > 500.0 {
            report.recommendations.push(Recommendation {
                priority: RecommendationPriority::High,
                category: "performance".to_string(),
                title: "실행 시간 최적화".to_string(),
                description: "평균 실행 시간이 높습니다. 알고리즘 최적화를 고려해보세요.".to_string(),
                actions: vec![
                    "코드 프로파일링 실행".to_string(),
                    "병목 지점 식별 및 최적화".to_string(),
                    "캐싱 전략 도입".to_string(),
                ],
            });
        }

        // 메모리 관리 권장사항
        if metrics.memory_pressure > 70.0 {
            report.recommendations.push(Recommendation {
                priority: RecommendationPriority::Medium,
                category: "memory".to_string(),
                title: "메모리 사용량 최적화".to_string(),
                description: "메모리 사용량이 높습니다. 메모리 관리를 개선해보세요.".to_string(),
                actions: vec![
                    "가비지 컬렉션 실행".to_string(),
                    "메모리 누수 점검".to_string(),
                    "메모리 한계 증가 고려".to_string(),
                ],
            });
        }

        // 처리량 개선 권장사항
        if metrics.throughput < 10.0 && metrics.function_calls > 100 {
            report.recommendations.push(Recommendation {
                priority: RecommendationPriority::Medium,
                category: "throughput".to_string(),
                title: "처리량 개선".to_string(),
                description: "낮은 처리량이 감지되었습니다.".to_string(),
                actions: vec![
                    "비동기 처리 도입".to_string(),
                    "배치 처리 최적화".to_string(),
                    "리소스 확장 고려".to_string(),
                ],
            });
        }
    }

    pub fn cleanup_old_data(&mut self) {
        log::info!("🧹 메트릭스 데이터 정리");

        let mut cleaned_series = 0;
        
        for (_, series_map) in self.time_series.iter_mut() {
            for (_, series) in series_map.iter_mut() {
                let old_count = series.samples.len();
                series.cleanup_old_samples();
                if series.samples.len() < old_count {
                    cleaned_series += old_count - series.samples.len();
                }
            }
        }

        log::info!("✅ 메트릭스 정리 완료: {} 샘플 정리됨", cleaned_series);
    }

    pub fn set_alert_threshold(&mut self, metric: &str, threshold: f64) {
        self.alert_thresholds.insert(metric.to_string(), threshold);
        log::info!("🚨 경고 임계값 설정: {} = {}", metric, threshold);
    }

    pub fn enable_monitoring(&mut self, enabled: bool) {
        self.monitoring_enabled = enabled;
        log::info!("📊 모니터링 {}", if enabled { "활성화" } else { "비활성화" });
    }

    pub fn reset_container_metrics(&mut self, container_id: &str) {
        if let Some(metrics) = self.container_metrics.get_mut(container_id) {
            metrics.reset();
            log::info!("🔄 메트릭스 리셋: {}", container_id);
        }
    }

    pub fn export_metrics(&self, format: &str) -> Result<String, JsValue> {
        match format {
            "json" => {
                match serde_json::to_string_pretty(&self.container_metrics) {
                    Ok(json) => Ok(json),
                    Err(e) => Err(JsValue::from_str(&e.to_string())),
                }
            }
            _ => Err(JsValue::from_str("Unsupported format")),
        }
    }
}

// 헬퍼 함수
fn get_current_time() -> f64 {
    window()
        .and_then(|w| w.performance())
        .map(|p| p.now())
        .unwrap_or(0.0)
}

// 추가 타입 정의들
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PerformanceReport {
    pub container_id: String,
    pub generated_at: f64,
    pub metrics: PerformanceMetrics,
    pub trends: HashMap<String, TrendAnalysis>,
    pub alerts: Vec<Alert>,
    pub recommendations: Vec<Recommendation>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrendAnalysis {
    pub direction: TrendDirection,
    pub rate_of_change: f64,
    pub confidence: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum TrendDirection {
    Increasing,
    Decreasing,
    Stable,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Alert {
    pub level: AlertLevel,
    pub message: String,
    pub metric: String,
    pub value: f64,
    pub threshold: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum AlertLevel {
    Info,
    Warning,
    Critical,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Recommendation {
    pub priority: RecommendationPriority,
    pub category: String,
    pub title: String,
    pub description: String,
    pub actions: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum RecommendationPriority {
    Low,
    Medium,
    High,
    Critical,
} 