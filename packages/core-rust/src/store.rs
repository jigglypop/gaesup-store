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
    fast_count: Option<i64>,
    counter_handle: Option<u32>,
    schema: Option<StoreSchema>,
    subscriptions: HashMap<String, Subscription>,
    snapshots: HashMap<String, Value>,
    metrics: StoreMetrics,
}

impl Store {
    fn new(state: Value) -> Self {
        let fast_count = state.get("count").and_then(Value::as_i64);
        Self {
            state,
            fast_count,
            counter_handle: None,
            schema: None,
            subscriptions: HashMap::new(),
            snapshots: HashMap::new(),
            metrics: StoreMetrics::new(),
        }
    }

    fn refresh_fast_count(&mut self) {
        self.fast_count = self.state.get("count").and_then(Value::as_i64);
    }

    fn flush_fast_count(&mut self) {
        if let Some(count) = self.fast_count {
            if let Some(object) = self.state.as_object_mut() {
                object.insert("count".to_string(), Value::Number(count.into()));
            }
        }
    }

    fn apply_fast_count_delta(&mut self, delta: i32, count: u32) -> Result<i64, JsValue> {
        if !self.state.is_object() {
            return Err(js_error("Fast counter dispatch requires an object state"));
        }

        let previous = self
            .fast_count
            .or_else(|| self.state.get("count").and_then(Value::as_i64))
            .unwrap_or(0);
        let next = previous + i64::from(delta) * i64::from(count);
        self.fast_count = Some(next);
        Ok(next)
    }

    fn flush_counter_lane(&mut self) {
        if let Some(handle) = self.counter_handle {
            COUNTER_HANDLES.with(|handles| {
                if let Some(lane) = handles.borrow_mut().get_mut(&handle) {
                    self.fast_count = Some(lane.value);
                    self.metrics.total_updates = self.metrics.total_updates.saturating_add(lane.pending_updates);
                    self.metrics.total_dispatches = self.metrics.total_dispatches.saturating_add(lane.pending_dispatches);
                    lane.pending_updates = 0;
                    lane.pending_dispatches = 0;
                }
            });
        }
        self.flush_fast_count();
    }

    fn sync_counter_lane_from_store(&mut self) {
        if let Some(handle) = self.counter_handle {
            let value = self.state.get("count").and_then(Value::as_i64).unwrap_or(0);
            self.fast_count = Some(value);
            COUNTER_HANDLES.with(|handles| {
                if let Some(lane) = handles.borrow_mut().get_mut(&handle) {
                    lane.value = value;
                    lane.pending_updates = 0;
                    lane.pending_dispatches = 0;
                }
            });
        }
    }
}

struct CounterLane {
    store_id: String,
    value: i64,
    pending_updates: u32,
    pending_dispatches: u32,
}

thread_local! {
    static STORES: RefCell<HashMap<String, Store>> = RefCell::new(HashMap::new());
    static COUNTER_HANDLES: RefCell<HashMap<u32, CounterLane>> = RefCell::new(HashMap::new());
    static NEXT_COUNTER_HANDLE: RefCell<u32> = const { RefCell::new(1) };
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
    COUNTER_HANDLES.with(|handles| {
        handles.borrow_mut().retain(|_, lane| lane.store_id != store_id);
    });
}

#[wasm_bindgen]
pub fn garbage_collect() {
    STORES.with(|stores| {
        stores.borrow_mut().clear();
    });
    COUNTER_HANDLES.with(|handles| {
        handles.borrow_mut().clear();
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
        store.flush_counter_lane();

        let next_state = apply_action(&store.state, action_type, payload)?;
        store.state = next_state.clone();
        store.refresh_fast_count();
        store.sync_counter_lane_from_store();
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

        store.flush_counter_lane();
        let mut next = store.state.clone();
        apply_counter_steps(&mut next, delta, 1, framework, action_name, timestamp)?;

        store.state = next.clone();
        store.refresh_fast_count();
        store.sync_counter_lane_from_store();
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

        store.flush_counter_lane();
        let mut next = store.state.clone();
        apply_counter_steps(&mut next, delta, count, framework, action_name, timestamp)?;

        store.state = next.clone();
        store.refresh_fast_count();
        store.sync_counter_lane_from_store();
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
pub fn dispatch_counter_fast(store_id: &str, delta: i32) -> Result<f64, JsValue> {
    STORES.with(|stores| {
        let mut stores = stores.borrow_mut();
        let store = stores
            .get_mut(store_id)
            .ok_or_else(|| js_error(&format!("Store not found: {store_id}")))?;

        let next_value = store.apply_fast_count_delta(delta, 1)?;
        store.metrics.total_updates += 1;
        store.metrics.total_dispatches += 1;
        Ok(next_value as f64)
    })
}

#[wasm_bindgen]
pub fn dispatch_counter_batch_fast(store_id: &str, delta: i32, count: u32) -> Result<f64, JsValue> {
    STORES.with(|stores| {
        let mut stores = stores.borrow_mut();
        let store = stores
            .get_mut(store_id)
            .ok_or_else(|| js_error(&format!("Store not found: {store_id}")))?;

        let next_value = store.apply_fast_count_delta(delta, count)?;
        store.metrics.total_updates += count;
        store.metrics.total_dispatches += count;
        Ok(next_value as f64)
    })
}

#[wasm_bindgen]
pub fn create_counter_handle(store_id: &str) -> Result<u32, JsValue> {
    STORES.with(|stores| {
        let mut stores = stores.borrow_mut();
        let store = stores
            .get_mut(store_id)
            .ok_or_else(|| js_error(&format!("Store not found: {store_id}")))?;

        if let Some(handle) = store.counter_handle {
            return Ok(handle);
        }

        let handle = NEXT_COUNTER_HANDLE.with(|next_handle| {
            let mut next_handle = next_handle.borrow_mut();
            let handle = *next_handle;
            *next_handle = next_handle.saturating_add(1).max(1);
            handle
        });
        let value = store
            .fast_count
            .or_else(|| store.state.get("count").and_then(Value::as_i64))
            .unwrap_or(0);
        store.fast_count = Some(value);
        store.counter_handle = Some(handle);
        COUNTER_HANDLES.with(|handles| {
            handles.borrow_mut().insert(handle, CounterLane {
                store_id: store_id.to_string(),
                value,
                pending_updates: 0,
                pending_dispatches: 0,
            });
        });
        Ok(handle)
    })
}

#[wasm_bindgen]
pub fn release_counter_handle(handle: u32) {
    let lane = COUNTER_HANDLES.with(|handles| handles.borrow_mut().remove(&handle));
    if let Some(lane) = lane {
        STORES.with(|stores| {
            if let Some(store) = stores.borrow_mut().get_mut(&lane.store_id) {
                store.fast_count = Some(lane.value);
                store.flush_fast_count();
                store.metrics.total_updates = store.metrics.total_updates.saturating_add(lane.pending_updates);
                store.metrics.total_dispatches = store.metrics.total_dispatches.saturating_add(lane.pending_dispatches);
                store.counter_handle = None;
            }
        });
    }
}

#[wasm_bindgen]
pub fn dispatch_counter_handle_fast(handle: u32, delta: i32) -> Result<f64, JsValue> {
    dispatch_counter_handle_batch_fast(handle, delta, 1)
}

#[wasm_bindgen]
pub fn dispatch_counter_handle_batch_fast(handle: u32, delta: i32, count: u32) -> Result<f64, JsValue> {
    COUNTER_HANDLES.with(|handles| {
        let mut handles = handles.borrow_mut();
        let lane = handles
            .get_mut(&handle)
            .ok_or_else(|| js_error(&format!("Counter handle not found: {handle}")))?;
        lane.value += i64::from(delta) * i64::from(count);
        lane.pending_updates = lane.pending_updates.saturating_add(count);
        lane.pending_dispatches = lane.pending_dispatches.saturating_add(count);
        Ok(lane.value as f64)
    })
}

#[wasm_bindgen]
pub fn dispatch_counter_handle_fast_unchecked(handle: u32, delta: i32) -> f64 {
    dispatch_counter_handle_batch_fast_unchecked(handle, delta, 1)
}

#[wasm_bindgen]
pub fn dispatch_counter_handle_batch_fast_unchecked(handle: u32, delta: i32, count: u32) -> f64 {
    COUNTER_HANDLES.with(|handles| {
        let mut handles = handles.borrow_mut();
        let Some(lane) = handles.get_mut(&handle) else {
            return f64::NAN;
        };
        lane.value += i64::from(delta) * i64::from(count);
        lane.pending_updates = lane.pending_updates.saturating_add(count);
        lane.pending_dispatches = lane.pending_dispatches.saturating_add(count);
        lane.value as f64
    })
}

#[wasm_bindgen]
pub fn select(store_id: &str, path: &str) -> Result<JsValue, JsValue> {
    STORES.with(|stores| {
        let mut stores = stores.borrow_mut();
        let store = stores
            .get_mut(store_id)
            .ok_or_else(|| js_error(&format!("Store not found: {store_id}")))?;

        store.metrics.total_selects += 1;
        if path == "count" {
            if let Some(handle) = store.counter_handle {
                if let Some(count) = counter_lane_value(handle) {
                    return Ok(JsValue::from_f64(count as f64));
                }
            }
            if let Some(count) = store.fast_count {
                return Ok(JsValue::from_f64(count as f64));
            }
        }
        if path.is_empty() {
            store.flush_counter_lane();
        }
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

        store.flush_counter_lane();
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
        store.refresh_fast_count();
        store.sync_counter_lane_from_store();
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
        let lane_metrics = store.counter_handle.and_then(counter_lane_metrics);
        let effective_count = store
            .counter_handle
            .and_then(counter_lane_value)
            .or(store.fast_count);
        let memory_state = if effective_count.is_some() {
            let mut state = store.state.clone();
            if let Some(object) = state.as_object_mut() {
                object.insert(
                    "count".to_string(),
                    Value::Number(effective_count.unwrap_or_default().into()),
                );
            }
            state
        } else {
            store.state.clone()
        };
        let metrics = serde_json::json!({
            "store_id": store_id,
            "subscriber_count": store.subscriptions.len(),
            "snapshot_count": store.snapshots.len(),
            "memory_usage": serde_json::to_string(&memory_state).map(|state| state.len()).unwrap_or(0),
            "total_selects": store.metrics.total_selects,
            "total_updates": store.metrics.total_updates + lane_metrics.map(|metrics| metrics.0).unwrap_or(0),
            "total_dispatches": store.metrics.total_dispatches + lane_metrics.map(|metrics| metrics.1).unwrap_or(0),
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

fn counter_lane_value(handle: u32) -> Option<i64> {
    COUNTER_HANDLES.with(|handles| {
        handles
            .borrow()
            .get(&handle)
            .map(|lane| lane.value)
    })
}

fn counter_lane_metrics(handle: u32) -> Option<(u32, u32)> {
    COUNTER_HANDLES.with(|handles| {
        handles
            .borrow()
            .get(&handle)
            .map(|lane| (lane.pending_updates, lane.pending_dispatches))
    })
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
    fn counter_fast_updates_count_without_touching_history() {
        let mut store = Store::new(json!({
            "count": 1,
            "history": [{ "action": "previous" }]
        }));
        let next = store.apply_fast_count_delta(2, 5).unwrap();
        store.flush_fast_count();

        assert_eq!(next, 11);
        assert_eq!(store.state["count"], 11);
        assert_eq!(store.state["history"].as_array().unwrap().len(), 1);
    }

    #[test]
    fn store_fast_count_flushes_to_state_when_needed() {
        let mut store = Store::new(json!({
            "count": 1,
            "name": "counter"
        }));
        let next = store.apply_fast_count_delta(3, 2).unwrap();
        assert_eq!(next, 7);
        assert_eq!(store.state["count"], 1);

        store.flush_fast_count();
        assert_eq!(store.state["count"], 7);
        assert_eq!(store.state["name"], "counter");
    }

    #[test]
    fn select_supports_object_and_array_paths() {
        let state = json!({ "users": [{ "name": "A" }, { "name": "B" }] });
        assert_eq!(select_value(&state, "users.1.name").unwrap(), "B");
    }
}
