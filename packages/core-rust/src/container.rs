use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::cell::RefCell;
use std::collections::HashMap;
use wasm_bindgen::prelude::*;

use crate::{from_js, js_error, next_id, to_js};

thread_local! {
    static CONTAINERS: RefCell<HashMap<String, WasmContainer>> = RefCell::new(HashMap::new());
}

#[derive(Clone, Serialize, Deserialize)]
struct WasmContainer {
    id: String,
    name: String,
    status: String,
    state: Value,
    calls: u32,
    created_at: f64,
}

impl WasmContainer {
    fn call_increment(&mut self, framework: &str, now: f64) -> i64 {
        self.calls += 1;
        let count = self.state.get("count").and_then(Value::as_i64).unwrap_or(0) + 1;
        self.state = serde_json::json!({
            "count": count,
            "framework": framework,
            "lastUpdated": now,
        });
        count
    }
}

#[wasm_bindgen]
pub fn create_container(config: JsValue) -> Result<JsValue, JsValue> {
    let config = from_js(config)?;
    let name = config
        .get("name")
        .and_then(Value::as_str)
        .unwrap_or("container")
        .to_string();
    let id = config
        .get("id")
        .and_then(Value::as_str)
        .map(ToString::to_string)
        .unwrap_or_else(|| next_id(&name));
    let state = config.get("initialState").cloned().unwrap_or_else(|| serde_json::json!({}));
    let container = WasmContainer {
        id: id.clone(),
        name,
        status: "running".to_string(),
        state,
        calls: 0,
        created_at: js_sys::Date::now(),
    };

    CONTAINERS.with(|containers| {
        containers.borrow_mut().insert(id, container.clone());
    });

    to_js(&container)
}

#[wasm_bindgen]
pub fn stop_container(container_id: &str) -> Result<JsValue, JsValue> {
    CONTAINERS.with(|containers| {
        let mut containers = containers.borrow_mut();
        let container = containers
            .get_mut(container_id)
            .ok_or_else(|| js_error(&format!("Container not found: {container_id}")))?;
        container.status = "stopped".to_string();
        to_js(container)
    })
}

#[wasm_bindgen]
pub fn call_container(container_id: &str, function_name: &str, args: JsValue) -> Result<JsValue, JsValue> {
    let args = from_js(args)?;
    CONTAINERS.with(|containers| {
        let mut containers = containers.borrow_mut();
        let container = containers
            .get_mut(container_id)
            .ok_or_else(|| js_error(&format!("Container not found: {container_id}")))?;
        let result = match function_name {
            "increment" => {
                let framework = args
                    .as_str()
                    .or_else(|| args.as_array().and_then(|items| items.first()).and_then(Value::as_str))
                    .unwrap_or("unknown");
                let count = container.call_increment(framework, js_sys::Date::now());
                serde_json::json!(count)
            }
            _ => {
                container.calls += 1;
                serde_json::json!({
                    "functionName": function_name,
                    "args": args,
                })
            },
        };

        to_js(&result)
    })
}

#[wasm_bindgen]
pub fn get_container_state(container_id: &str) -> Result<JsValue, JsValue> {
    CONTAINERS.with(|containers| {
        let containers = containers.borrow();
        let container = containers
            .get(container_id)
            .ok_or_else(|| js_error(&format!("Container not found: {container_id}")))?;
        to_js(&container.state)
    })
}

#[wasm_bindgen]
pub fn get_container_metrics(container_id: &str) -> Result<JsValue, JsValue> {
    CONTAINERS.with(|containers| {
        let containers = containers.borrow();
        let container = containers
            .get(container_id)
            .ok_or_else(|| js_error(&format!("Container not found: {container_id}")))?;
        to_js(&serde_json::json!({
            "id": container.id,
            "status": container.status,
            "uptimeMs": js_sys::Date::now() - container.created_at,
            "calls": container.calls,
            "memoryUsage": serde_json::to_string(&container.state).map(|state| state.len()).unwrap_or(0),
        }))
    })
}

#[wasm_bindgen]
pub fn list_containers() -> Result<JsValue, JsValue> {
    CONTAINERS.with(|containers| {
        let items: Vec<Value> = containers
            .borrow()
            .values()
            .map(|container| serde_json::json!({
                "id": container.id,
                "name": container.name,
                "status": container.status,
            }))
            .collect();
        to_js(&items)
    })
}

#[wasm_bindgen]
pub fn cleanup_containers() {
    CONTAINERS.with(|containers| {
        containers.borrow_mut().clear();
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn increment_updates_state_and_call_count() {
        let mut container = WasmContainer {
            id: "c1".to_string(),
            name: "counter".to_string(),
            status: "running".to_string(),
            state: json!({ "count": 41 }),
            calls: 0,
            created_at: 0.0,
        };

        let count = container.call_increment("react", 123.0);

        assert_eq!(count, 42);
        assert_eq!(container.calls, 1);
        assert_eq!(container.state["count"], 42);
        assert_eq!(container.state["framework"], "react");
        assert_eq!(container.state["lastUpdated"], 123.0);
    }
}
