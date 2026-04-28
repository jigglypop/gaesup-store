use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::cell::RefCell;
use std::collections::HashMap;
use wasm_bindgen::prelude::*;

use crate::{from_js, js_error, json_number, next_id, to_js};

#[derive(Clone, Serialize, Deserialize)]
struct StoreSchema {
    #[serde(rename = "storeId")]
    store_id: String,
    #[serde(rename = "schemaId")]
    schema_id: String,
    #[serde(rename = "schemaVersion")]
    schema_version: String,
    #[serde(rename = "compatRange", skip_serializing_if = "Option::is_none")]
    compat_range: Option<String>,
}

struct Subscription {
    path: String,
    callback: js_sys::Function,
}

struct StoreMetrics {
    total_selects: u32,
    total_updates: u32,
    total_dispatches: u32,
    dispatch_time_total: f64,
}

impl StoreMetrics {
    fn new() -> Self {
        Self {
            total_selects: 0,
            total_updates: 0,
            total_dispatches: 0,
            dispatch_time_total: 0.0,
        }
    }
}

struct Store {
    state: Value,
    schema: Option<StoreSchema>,
    subscriptions: HashMap<String, Subscription>,
    snapshots: HashMap<String, Value>,
    metrics: StoreMetrics,
}

impl Store {
    fn new(state: Value) -> Self {
        Self {
            state,
            schema: None,
            subscriptions: HashMap::new(),
            snapshots: HashMap::new(),
            metrics: StoreMetrics::new(),
        }
    }
}

thread_local! {
    static STORES: RefCell<HashMap<String, Store>> = RefCell::new(HashMap::new());
}

#[wasm_bindgen]
pub fn create_store(store_id: &str, initial_state: JsValue) -> Result<(), JsValue> {
    let state = from_js(initial_state)?;

    STORES.with(|stores| {
        let mut stores = stores.borrow_mut();
        if stores.contains_key(store_id) {
            return Err(js_error(&format!("Store already exists: {store_id}")));
        }

        stores.insert(store_id.to_string(), Store::new(state));
        Ok(())
    })
}

#[wasm_bindgen]
pub fn cleanup_store(store_id: &str) {
    STORES.with(|stores| {
        stores.borrow_mut().remove(store_id);
    });
}

#[wasm_bindgen]
pub fn garbage_collect() {
    STORES.with(|stores| {
        stores.borrow_mut().clear();
    });
}

#[wasm_bindgen]
pub fn dispatch(store_id: &str, action_type: &str, payload: JsValue) -> Result<JsValue, JsValue> {
    let start = js_sys::Date::now();
    let payload = from_js(payload)?;

    let (next_state, notifications) = STORES.with(|stores| {
        let mut stores = stores.borrow_mut();
        let store = stores
            .get_mut(store_id)
            .ok_or_else(|| js_error(&format!("Store not found: {store_id}")))?;

        let next_state = apply_action(&store.state, action_type, payload)?;
        store.state = next_state.clone();
        store.metrics.total_updates += 1;
        store.metrics.total_dispatches += 1;
        store.metrics.dispatch_time_total += js_sys::Date::now() - start;
        let notifications = collect_notifications(store);
        Ok::<(Value, Vec<(String, js_sys::Function)>), JsValue>((next_state, notifications))
    })?;

    notify_subscribers(&next_state, &notifications)?;
    to_js(&next_state)
}

#[wasm_bindgen]
pub fn dispatch_counter(store_id: &str, delta: i32, framework: &str, action_name: &str) -> Result<JsValue, JsValue> {
    let start = js_sys::Date::now();
    let timestamp = js_sys::Date::now();

    let (next_state, notifications) = STORES.with(|stores| {
        let mut stores = stores.borrow_mut();
        let store = stores
            .get_mut(store_id)
            .ok_or_else(|| js_error(&format!("Store not found: {store_id}")))?;

        let mut next = store.state.clone();
        apply_counter_steps(&mut next, delta, 1, framework, action_name, timestamp)?;

        store.state = next.clone();
        store.metrics.total_updates += 1;
        store.metrics.total_dispatches += 1;
        store.metrics.dispatch_time_total += js_sys::Date::now() - start;
        let notifications = collect_notifications(store);
        Ok::<(Value, Vec<(String, js_sys::Function)>), JsValue>((next, notifications))
    })?;

    notify_subscribers(&next_state, &notifications)?;
    to_js(&next_state)
}

#[wasm_bindgen]
pub fn dispatch_counter_batch(
    store_id: &str,
    delta: i32,
    count: u32,
    framework: &str,
    action_name: &str,
) -> Result<JsValue, JsValue> {
    let start = js_sys::Date::now();
    let timestamp = js_sys::Date::now();

    let (next_state, notifications) = STORES.with(|stores| {
        let mut stores = stores.borrow_mut();
        let store = stores
            .get_mut(store_id)
            .ok_or_else(|| js_error(&format!("Store not found: {store_id}")))?;

        let mut next = store.state.clone();
        apply_counter_steps(&mut next, delta, count, framework, action_name, timestamp)?;

        store.state = next.clone();
        store.metrics.total_updates += count;
        store.metrics.total_dispatches += count;
        store.metrics.dispatch_time_total += js_sys::Date::now() - start;
        let notifications = collect_notifications(store);
        Ok::<(Value, Vec<(String, js_sys::Function)>), JsValue>((next, notifications))
    })?;

    notify_subscribers(&next_state, &notifications)?;
    to_js(&next_state)
}

#[wasm_bindgen]
pub fn select(store_id: &str, path: &str) -> Result<JsValue, JsValue> {
    STORES.with(|stores| {
        let mut stores = stores.borrow_mut();
        let store = stores
            .get_mut(store_id)
            .ok_or_else(|| js_error(&format!("Store not found: {store_id}")))?;

        store.metrics.total_selects += 1;
        match select_value(&store.state, path) {
            Some(value) => to_js(value),
            None => Ok(JsValue::UNDEFINED),
        }
    })
}

#[wasm_bindgen]
pub fn subscribe(store_id: &str, path: &str, callback: js_sys::Function) -> Result<String, JsValue> {
    STORES.with(|stores| {
        let mut stores = stores.borrow_mut();
        let store = stores
            .get_mut(store_id)
            .ok_or_else(|| js_error(&format!("Store not found: {store_id}")))?;

        let subscription_id = next_id("sub");
        store.subscriptions.insert(
            subscription_id.clone(),
            Subscription {
                path: path.to_string(),
                callback,
            },
        );

        Ok(subscription_id)
    })
}

#[wasm_bindgen]
pub fn unsubscribe(subscription_id: &str) {
    STORES.with(|stores| {
        for store in stores.borrow_mut().values_mut() {
            store.subscriptions.remove(subscription_id);
        }
    });
}

#[wasm_bindgen]
pub fn create_snapshot(store_id: &str) -> Result<String, JsValue> {
    STORES.with(|stores| {
        let mut stores = stores.borrow_mut();
        let store = stores
            .get_mut(store_id)
            .ok_or_else(|| js_error(&format!("Store not found: {store_id}")))?;

        let snapshot_id = next_id("snap");
        store.snapshots.insert(snapshot_id.clone(), store.state.clone());
        Ok(snapshot_id)
    })
}

#[wasm_bindgen]
pub fn restore_snapshot(store_id: &str, snapshot_id: &str) -> Result<JsValue, JsValue> {
    let (restored, notifications) = STORES.with(|stores| {
        let mut stores = stores.borrow_mut();
        let store = stores
            .get_mut(store_id)
            .ok_or_else(|| js_error(&format!("Store not found: {store_id}")))?;

        let snapshot = store
            .snapshots
            .get(snapshot_id)
            .cloned()
            .ok_or_else(|| js_error(&format!("Snapshot not found: {snapshot_id}")))?;

        store.state = snapshot.clone();
        let notifications = collect_notifications(store);
        Ok::<(Value, Vec<(String, js_sys::Function)>), JsValue>((snapshot, notifications))
    })?;

    notify_subscribers(&restored, &notifications)?;
    to_js(&restored)
}

#[wasm_bindgen]
pub fn get_metrics(store_id: &str) -> Result<JsValue, JsValue> {
    STORES.with(|stores| {
        let stores = stores.borrow();
        let store = stores
            .get(store_id)
            .ok_or_else(|| js_error(&format!("Store not found: {store_id}")))?;

        let mut avg_dispatch_time = store.metrics.dispatch_time_total
            / f64::from(store.metrics.total_dispatches.max(1));
        if store.metrics.total_dispatches > 0 && avg_dispatch_time <= 0.0 {
            avg_dispatch_time = 0.001;
        }
        let metrics = serde_json::json!({
            "store_id": store_id,
            "subscriber_count": store.subscriptions.len(),
            "snapshot_count": store.snapshots.len(),
            "memory_usage": serde_json::to_string(&store.state).map(|state| state.len()).unwrap_or(0),
            "total_selects": store.metrics.total_selects,
            "total_updates": store.metrics.total_updates,
            "total_dispatches": store.metrics.total_dispatches,
            "avg_dispatch_time": avg_dispatch_time,
            "schema": store.schema,
            "timestamp": Utc::now().to_rfc3339(),
        });

        to_js(&metrics)
    })
}

#[wasm_bindgen]
pub fn register_store_schema(schema: JsValue) -> Result<(), JsValue> {
    let schema: StoreSchema = serde_wasm_bindgen::from_value(schema)?;

    STORES.with(|stores| {
        let mut stores = stores.borrow_mut();
        let store = stores
            .get_mut(&schema.store_id)
            .ok_or_else(|| js_error(&format!("Store not found: {}", schema.store_id)))?;
        store.schema = Some(schema);
        Ok(())
    })
}

#[wasm_bindgen]
pub fn get_store_schemas() -> Result<JsValue, JsValue> {
    STORES.with(|stores| {
        let schemas: Vec<StoreSchema> = stores
            .borrow()
            .values()
            .filter_map(|store| store.schema.clone())
            .collect();
        to_js(&schemas)
    })
}

#[wasm_bindgen]
pub struct BatchUpdate {
    store_id: String,
    updates: Vec<(String, JsValue)>,
}

#[wasm_bindgen]
impl BatchUpdate {
    #[wasm_bindgen(constructor)]
    pub fn new(store_id: &str) -> Self {
        Self {
            store_id: store_id.to_string(),
            updates: Vec::new(),
        }
    }

    pub fn add_update(&mut self, action_type: &str, payload: JsValue) {
        self.updates.push((action_type.to_string(), payload));
    }

    pub fn execute(&self) -> Result<JsValue, JsValue> {
        let mut result = JsValue::UNDEFINED;
        for (action_type, payload) in &self.updates {
            result = dispatch(&self.store_id, action_type, payload.clone())?;
        }
        Ok(result)
    }
}

fn apply_action(current: &Value, action_type: &str, payload: Value) -> Result<Value, JsValue> {
    match action_type {
        "SET" => Ok(payload),
        "MERGE" => Ok(merge_state(current, payload)),
        "UPDATE" => {
            let path = payload
                .get("path")
                .and_then(Value::as_str)
                .ok_or_else(|| js_error("UPDATE requires payload.path"))?;
            let value = payload.get("value").cloned().unwrap_or(Value::Null);
            let mut next = current.clone();
            set_path(&mut next, path, value);
            Ok(next)
        }
        "DELETE" => {
            let path = payload
                .as_str()
                .or_else(|| payload.get("path").and_then(Value::as_str))
                .ok_or_else(|| js_error("DELETE requires a path"))?;
            let mut next = current.clone();
            delete_path(&mut next, path);
            Ok(next)
        }
        "BATCH" => {
            let updates = payload
                .as_array()
                .ok_or_else(|| js_error("BATCH requires an array payload"))?;
            let mut next = current.clone();

            for update in updates {
                let nested_action_type = update
                    .get("actionType")
                    .or_else(|| update.get("type"))
                    .and_then(Value::as_str)
                    .unwrap_or("UPDATE");
                let nested_payload = update.get("payload").cloned().unwrap_or_else(|| update.clone());
                next = apply_action(&next, nested_action_type, nested_payload)?;
            }

            Ok(next)
        }
        _ => Ok(current.clone()),
    }
}

fn apply_counter_steps(
    state: &mut Value,
    delta: i32,
    count: u32,
    framework: &str,
    action_name: &str,
    timestamp: f64,
) -> Result<(), JsValue> {
    let object = state
        .as_object_mut()
        .ok_or_else(|| js_error("Counter dispatch requires an object state"))?;
    let previous = object.get("count").and_then(Value::as_i64).unwrap_or(0);
    let total_delta = i64::from(delta) * i64::from(count);
    let new_value = previous + total_delta;

    object.insert("count".to_string(), Value::Number(new_value.into()));
    object.insert("lastUpdated".to_string(), json_number(timestamp));
    object.insert("framework".to_string(), Value::String(framework.to_string()));

    let mut history = object
        .get("history")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();

    let start = count.saturating_sub(10);
    for index in start..count {
        let step_previous = previous + i64::from(delta) * i64::from(index);
        let step_new = step_previous + i64::from(delta);
        history.push(serde_json::json!({
            "action": action_name,
            "framework": framework,
            "timestamp": timestamp,
            "previousValue": step_previous,
            "newValue": step_new,
        }));
    }
    if history.len() > 10 {
        history = history.split_off(history.len() - 10);
    }
    object.insert("history".to_string(), Value::Array(history));
    Ok(())
}

fn merge_state(current: &Value, payload: Value) -> Value {
    match (current, payload) {
        (Value::Object(current_object), Value::Object(payload_object)) => {
            let mut next = current_object.clone();
            for (key, value) in payload_object {
                next.insert(key, value);
            }
            Value::Object(next)
        }
        (_, payload) => payload,
    }
}

fn select_value<'a>(state: &'a Value, path: &str) -> Option<&'a Value> {
    if path.is_empty() {
        return Some(state);
    }

    let mut current = state;
    for part in path.split('.') {
        current = match current {
            Value::Object(object) => object.get(part)?,
            Value::Array(array) => array.get(part.parse::<usize>().ok()?)?,
            _ => return None,
        };
    }

    Some(current)
}

fn set_path(state: &mut Value, path: &str, value: Value) {
    let parts: Vec<&str> = path.split('.').filter(|part| !part.is_empty()).collect();
    if parts.is_empty() {
        *state = value;
        return;
    }

    let mut current = state;
    for part in &parts[..parts.len() - 1] {
        if !current.is_object() {
            *current = Value::Object(Map::new());
        }

        let object = current.as_object_mut().expect("object was just created");
        current = object
            .entry((*part).to_string())
            .or_insert_with(|| Value::Object(Map::new()));
    }

    if !current.is_object() {
        *current = Value::Object(Map::new());
    }

    if let Some(object) = current.as_object_mut() {
        object.insert(parts[parts.len() - 1].to_string(), value);
    }
}

fn delete_path(state: &mut Value, path: &str) {
    let parts: Vec<&str> = path.split('.').filter(|part| !part.is_empty()).collect();
    if parts.is_empty() {
        *state = Value::Null;
        return;
    }

    let mut current = state;
    for part in &parts[..parts.len() - 1] {
        current = match current {
            Value::Object(object) => match object.get_mut(*part) {
                Some(value) => value,
                None => return,
            },
            _ => return,
        };
    }

    if let Value::Object(object) = current {
        object.remove(parts[parts.len() - 1]);
    }
}

fn collect_notifications(store: &Store) -> Vec<(String, js_sys::Function)> {
    store
        .subscriptions
        .values()
        .map(|subscription| (subscription.path.clone(), subscription.callback.clone()))
        .collect()
}

fn notify_subscribers(
    state: &Value,
    notifications: &[(String, js_sys::Function)]
) -> Result<(), JsValue> {
    for (path, callback) in notifications {
        let selected = select_value(state, path).unwrap_or(&Value::Null);
        let selected = to_js(selected)?;
        callback
            .call1(&JsValue::NULL, &selected)
            .map_err(|error| js_error(&format!("Subscriber callback failed: {:?}", error)))?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn merge_replaces_only_payload_keys() {
        let current = json!({ "count": 1, "name": "orders" });
        let next = merge_state(&current, json!({ "count": 2 }));
        assert_eq!(next["count"], 2);
        assert_eq!(next["name"], "orders");
    }

    #[test]
    fn update_sets_nested_path() {
        let current = json!({ "user": { "name": "A" } });
        let next = apply_action(&current, "UPDATE", json!({
            "path": "user.age",
            "value": 7
        })).unwrap();
        assert_eq!(next["user"]["name"], "A");
        assert_eq!(next["user"]["age"], 7);
    }

    #[test]
    fn delete_removes_nested_path() {
        let current = json!({ "user": { "name": "A", "age": 7 } });
        let next = apply_action(&current, "DELETE", json!("user.age")).unwrap();
        assert!(next["user"].get("age").is_none());
    }

    #[test]
    fn counter_batch_updates_count_and_keeps_last_ten_history_entries() {
        let mut state = json!({
            "count": 0,
            "history": []
        });
        apply_counter_steps(&mut state, 1, 12, "bench", "INCREMENT", 100.0).unwrap();

        assert_eq!(state["count"], 12);
        let history = state["history"].as_array().unwrap();
        assert_eq!(history.len(), 10);
        assert_eq!(history[0]["previousValue"], 2);
        assert_eq!(history[9]["newValue"], 12);
    }

    #[test]
    fn select_supports_object_and_array_paths() {
        let state = json!({ "users": [{ "name": "A" }, { "name": "B" }] });
        assert_eq!(select_value(&state, "users.1.name").unwrap(), "B");
    }
}
