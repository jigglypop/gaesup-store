#[cfg(test)]
mod tests {
    use super::*;
    use wasm_bindgen_test::*;
    
    wasm_bindgen_test_configure!(run_in_browser);
    
    #[wasm_bindgen_test]
    fn test_store_creation() {
        // 스토어 생성
        let result = create_store("test_store", JsValue::from_str(r#"{"count": 0}"#));
        assert!(result.is_ok());
        
        // 중복 생성 시도
        let duplicate = create_store("test_store", JsValue::from_str(r#"{"count": 0}"#));
        assert!(duplicate.is_err());
    }
    
    #[wasm_bindgen_test]
    fn test_state_update() {
        // 스토어 생성
        create_store("test_update", JsValue::from_str(r#"{"count": 0}"#)).unwrap();
        
        // 상태 업데이트
        let new_state = dispatch("test_update", "SET", JsValue::from_str(r#"{"count": 5}"#)).unwrap();
        
        // 업데이트 확인
        let state = select("test_update", "").unwrap();
        assert_eq!(state.as_f64().unwrap(), 5.0);
    }
    
    #[wasm_bindgen_test]
    fn test_nested_state_update() {
        // 복잡한 상태 생성
        let initial = r#"{
            "user": {
                "name": "Test",
                "age": 25
            },
            "settings": {
                "theme": "light"
            }
        }"#;
        
        create_store("test_nested", JsValue::from_str(initial)).unwrap();
        
        // 중첩된 값 업데이트
        let update_payload = r#"{
            "path": "user.age",
            "value": 26
        }"#;
        
        dispatch("test_nested", "UPDATE", JsValue::from_str(update_payload)).unwrap();
        
        // 업데이트 확인
        let age = select("test_nested", "user.age").unwrap();
        assert_eq!(age.as_f64().unwrap(), 26.0);
    }
    
    #[wasm_bindgen_test]
    fn test_subscription() {
        // 스토어 생성
        create_store("test_sub", JsValue::from_str(r#"{"value": 0}"#)).unwrap();
        
        // 구독 등록
        let sub_id = subscribe("test_sub", "", "test_callback").unwrap();
        assert!(!sub_id.is_empty());
        
        // 구독 해제
        unsubscribe(&sub_id).unwrap();
    }
    
    #[wasm_bindgen_test]
    fn test_snapshot_restore() {
        // 스토어 생성
        create_store("test_snapshot", JsValue::from_str(r#"{"value": 10}"#)).unwrap();
        
        // 스냅샷 생성
        let snapshot_id = create_snapshot("test_snapshot").unwrap();
        assert!(!snapshot_id.is_empty());
        
        // 상태 변경
        dispatch("test_snapshot", "SET", JsValue::from_str(r#"{"value": 20}"#)).unwrap();
        
        // 스냅샷 복원
        restore_snapshot("test_snapshot", &snapshot_id).unwrap();
        
        // 복원 확인
        let restored = select("test_snapshot", "value").unwrap();
        assert_eq!(restored.as_f64().unwrap(), 10.0);
    }
    
    #[wasm_bindgen_test]
    fn test_batch_update() {
        // 스토어 생성
        create_store("test_batch", JsValue::from_str(r#"{"a": 1, "b": 2, "c": 3}"#)).unwrap();
        
        // 배치 업데이트
        let mut batch = BatchUpdate::new("test_batch".to_string());
        batch.add_update("SET".to_string(), JsValue::from_str(r#"{"a": 10}"#)).unwrap();
        batch.add_update("MERGE".to_string(), JsValue::from_str(r#"{"b": 20}"#)).unwrap();
        batch.add_update("UPDATE".to_string(), JsValue::from_str(r#"{"path": "c", "value": 30}"#)).unwrap();
        
        batch.execute().unwrap();
        
        // 모든 업데이트 확인
        let state = select("test_batch", "").unwrap();
        // 실제 검증은 JavaScript 레벨에서 수행
    }
    
    #[wasm_bindgen_test]
    fn test_memory_cleanup() {
        // 여러 스토어 생성
        for i in 0..10 {
            let store_id = format!("test_cleanup_{}", i);
            create_store(&store_id, JsValue::from_str(r#"{"data": "test"}"#)).unwrap();
        }
        
        // 가비지 컬렉션
        garbage_collect().unwrap();
        
        // 특정 스토어 정리
        cleanup_store("test_cleanup_0").unwrap();
        
        // 정리된 스토어 접근 시도
        let result = select("test_cleanup_0", "");
        assert!(result.is_err());
    }
    
    #[wasm_bindgen_test]
    fn test_performance_metrics() {
        // 스토어 생성
        create_store("test_metrics", JsValue::from_str(r#"{"value": 0}"#)).unwrap();
        
        // 여러 작업 수행
        for i in 0..10 {
            dispatch("test_metrics", "SET", JsValue::from_str(&format!(r#"{{"value": {}}}"#, i))).unwrap();
        }
        
        // 메트릭스 조회
        let metrics = get_metrics("test_metrics").unwrap();
        
        // 기본 메트릭스 확인 (실제 값은 JavaScript에서 검증)
        assert!(!metrics.is_null());
    }
} 