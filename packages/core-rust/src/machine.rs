use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::cell::RefCell;
use std::collections::HashMap;
use wasm_bindgen::prelude::*;

use crate::{from_js, js_error, next_id, to_js};

thread_local! {
    static MACHINES: RefCell<HashMap<String, MachineInstance>> = RefCell::new(HashMap::new());
}

#[derive(Clone)]
struct MachineInstance {
    id: String,
    definition: Value,
    state: String,
    context: Value,
    status: String,
    step: u32,
    history: Vec<MachineHistoryEntry>,
    checkpoints: Vec<MachineCheckpoint>,
}

#[derive(Clone, Serialize, Deserialize)]
struct MachineHistoryEntry {
    from: String,
    to: String,
    event: String,
    timestamp: f64,
    #[serde(rename = "durationMs")]
    duration_ms: f64,
}

#[derive(Clone)]
struct MachineCheckpoint {
    state: String,
    context: Value,
    status: String,
    step: u32,
    history: Vec<MachineHistoryEntry>,
}

#[wasm_bindgen]
pub fn create_machine(definition: JsValue) -> Result<String, JsValue> {
    let definition = from_js(definition)?;
    let id = definition
        .get("id")
        .and_then(Value::as_str)
        .map(ToString::to_string)
        .unwrap_or_else(|| next_id("machine"));
    let initial = definition
        .get("initial")
        .and_then(Value::as_str)
        .ok_or_else(|| js_error("Machine definition requires initial"))?
        .to_string();
    let context = definition
        .get("context")
        .cloned()
        .unwrap_or_else(|| Value::Object(Map::new()));

    if state_node(&definition, &initial).is_none() {
        return Err(js_error(&format!("Initial state not found: {initial}")));
    }

    let status = if is_final_state(&definition, &initial) {
        "final"
    } else {
        "active"
    }
    .to_string();

    MACHINES.with(|machines| {
        machines.borrow_mut().insert(
            id.clone(),
            MachineInstance {
                id: id.clone(),
                definition,
                state: initial,
                context,
                status,
                step: 0,
                history: Vec::new(),
                checkpoints: Vec::new(),
            },
        );
    });

    Ok(id)
}

#[wasm_bindgen]
pub fn start_machine(machine_id: &str, context: JsValue) -> Result<JsValue, JsValue> {
    let context = from_js(context)?;
    MACHINES.with(|machines| {
        let mut machines = machines.borrow_mut();
        let machine = machines
            .get_mut(machine_id)
            .ok_or_else(|| js_error(&format!("Machine not found: {machine_id}")))?;
        if !context.is_null() {
            machine.context = context;
        }
        to_js(&snapshot(machine, false, Vec::new()))
    })
}

#[wasm_bindgen]
pub fn send_machine(machine_id: &str, event: JsValue) -> Result<JsValue, JsValue> {
    let start = js_sys::Date::now();
    let event = from_js(event)?;
    let event_type = event
        .get("type")
        .and_then(Value::as_str)
        .ok_or_else(|| js_error("Machine event requires type"))?
        .to_string();

    MACHINES.with(|machines| {
        let mut machines = machines.borrow_mut();
        let machine = machines
            .get_mut(machine_id)
            .ok_or_else(|| js_error(&format!("Machine not found: {machine_id}")))?;

        if machine.status == "final" {
            return to_js(&transition_result(
                false,
                machine,
                "FINAL_STATE",
                Vec::new(),
            ));
        }

        let current_state = state_node(&machine.definition, &machine.state)
            .ok_or_else(|| js_error(&format!("State not found: {}", machine.state)))?;
        let Some(transition) = transition_for_event(current_state, &event_type) else {
            return to_js(&transition_result(
                false,
                machine,
                "TRANSITION_NOT_FOUND",
                Vec::new(),
            ));
        };

        if !guard_allows(&transition, &machine.context, &event) {
            return to_js(&transition_result(
                false,
                machine,
                "GUARD_REJECTED",
                Vec::new(),
            ));
        }

        let target = transition
            .get("target")
            .and_then(Value::as_str)
            .unwrap_or(&machine.state)
            .to_string();

        if state_node(&machine.definition, &target).is_none() {
            return Err(js_error(&format!("Target state not found: {target}")));
        }

        let checkpoint_limit = checkpoint_limit(&machine.definition);
        if checkpoint_limit > 0 {
            machine.checkpoints.push(MachineCheckpoint {
                state: machine.state.clone(),
                context: machine.context.clone(),
                status: machine.status.clone(),
                step: machine.step,
                history: machine.history.clone(),
            });
            if machine.checkpoints.len() > checkpoint_limit {
                machine.checkpoints.remove(0);
            }
        }

        let from = machine.state.clone();
        let mut next_context = machine.context.clone();
        apply_assign(&mut next_context, &transition, &event);

        let actions = collect_actions(&machine.definition, &from, &target, &transition, &event);
        let duration = js_sys::Date::now() - start;
        let history_limit = history_limit(&machine.definition);
        if history_limit > 0 {
            machine.history.push(MachineHistoryEntry {
                from: from.clone(),
                to: target.clone(),
                event: event_type,
                timestamp: now_ms(),
                duration_ms: duration,
            });
            if machine.history.len() > history_limit {
                machine.history.remove(0);
            }
        }

        machine.state = target;
        machine.context = next_context;
        machine.step = machine.step.saturating_add(1);
        machine.status = if is_final_state(&machine.definition, &machine.state) {
            "final".to_string()
        } else {
            "active".to_string()
        };

        to_js(&transition_result(true, machine, "", actions))
    })
}

#[wasm_bindgen]
pub fn get_machine_snapshot(machine_id: &str) -> Result<JsValue, JsValue> {
    MACHINES.with(|machines| {
        let machines = machines.borrow();
        let machine = machines
            .get(machine_id)
            .ok_or_else(|| js_error(&format!("Machine not found: {machine_id}")))?;
        to_js(&snapshot(machine, false, Vec::new()))
    })
}

#[wasm_bindgen]
pub fn rollback_machine(machine_id: &str, steps: u32) -> Result<JsValue, JsValue> {
    MACHINES.with(|machines| {
        let mut machines = machines.borrow_mut();
        let machine = machines
            .get_mut(machine_id)
            .ok_or_else(|| js_error(&format!("Machine not found: {machine_id}")))?;
        let count = steps.max(1);
        let mut checkpoint = None;
        for _ in 0..count {
            checkpoint = machine.checkpoints.pop();
            if checkpoint.is_none() {
                break;
            }
        }
        let Some(checkpoint) = checkpoint else {
            return to_js(&transition_result(
                false,
                machine,
                "ROLLBACK_CHECKPOINT_NOT_FOUND",
                Vec::new(),
            ));
        };

        machine.state = checkpoint.state;
        machine.context = checkpoint.context;
        machine.status = checkpoint.status;
        machine.step = checkpoint.step;
        machine.history = checkpoint.history;

        to_js(&transition_result(true, machine, "", Vec::new()))
    })
}

#[wasm_bindgen]
pub fn cleanup_machine(machine_id: &str) {
    MACHINES.with(|machines| {
        machines.borrow_mut().remove(machine_id);
    });
}

#[wasm_bindgen]
pub fn cleanup_machines() {
    MACHINES.with(|machines| {
        machines.borrow_mut().clear();
    });
}

fn transition_result(
    accepted: bool,
    machine: &MachineInstance,
    rejected_reason: &str,
    effects: Vec<Value>,
) -> Value {
    let mut result = serde_json::json!({
        "accepted": accepted,
        "snapshot": snapshot(machine, accepted, effects.clone()),
        "effects": effects,
    });
    if !rejected_reason.is_empty() {
        result["rejectedReason"] = Value::String(rejected_reason.to_string());
    }
    result
}

fn snapshot(machine: &MachineInstance, changed: bool, actions: Vec<Value>) -> Value {
    serde_json::json!({
        "machineId": machine.id,
        "state": machine.state,
        "context": machine.context,
        "status": machine.status,
        "step": machine.step,
        "history": machine.history,
        "changed": changed,
        "actions": actions,
    })
}

fn state_node<'a>(definition: &'a Value, state: &str) -> Option<&'a Value> {
    definition.get("states")?.get(state)
}

fn transition_for_event(state: &Value, event_type: &str) -> Option<Value> {
    let transition = state.get("on")?.get(event_type)?;
    if transition.is_string() {
        Some(serde_json::json!({ "target": transition.as_str().unwrap_or_default() }))
    } else if transition.is_array() {
        transition.as_array()?.first().cloned()
    } else {
        Some(transition.clone())
    }
}

fn is_final_state(definition: &Value, state: &str) -> bool {
    state_node(definition, state)
        .and_then(|node| node.get("final"))
        .and_then(Value::as_bool)
        .unwrap_or(false)
}

fn guard_allows(transition: &Value, context: &Value, event: &Value) -> bool {
    let Some(guard) = transition.get("guard").or_else(|| transition.get("cond")) else {
        return true;
    };

    if let Some(name) = guard.as_str() {
        return event
            .get("__guards")
            .and_then(|guards| guards.get(name))
            .and_then(Value::as_bool)
            .unwrap_or(false);
    }

    if guard.is_object() {
        return evaluate_guard_object(guard, context, event);
    }

    false
}

fn evaluate_guard_object(guard: &Value, context: &Value, event: &Value) -> bool {
    let path = guard.get("path").and_then(Value::as_str).unwrap_or("");
    let op = guard.get("op").and_then(Value::as_str).unwrap_or("==");
    let expected = guard.get("value").unwrap_or(&Value::Null);
    let actual = resolve_path_token(path, context, event);

    match op {
        "==" | "eq" => actual == *expected,
        "!=" | "neq" => actual != *expected,
        ">" => compare_number(&actual, expected) > 0,
        ">=" => compare_number(&actual, expected) >= 0,
        "<" => compare_number(&actual, expected) < 0,
        "<=" => compare_number(&actual, expected) <= 0,
        "exists" => !actual.is_null(),
        _ => false,
    }
}

fn compare_number(left: &Value, right: &Value) -> i32 {
    let left = left.as_f64().unwrap_or(0.0);
    let right = right.as_f64().unwrap_or(0.0);
    if left > right {
        1
    } else if left < right {
        -1
    } else {
        0
    }
}

fn apply_assign(context: &mut Value, transition: &Value, event: &Value) {
    let Some(assign) = transition.get("assign").and_then(Value::as_object) else {
        return;
    };
    let previous = context.clone();
    for (path, expression) in assign {
        let value = resolve_assignment_value(expression, &previous, event);
        set_path(context, path, value);
    }
}

fn resolve_assignment_value(expression: &Value, context: &Value, event: &Value) -> Value {
    if let Some(token) = expression.as_str() {
        return resolve_path_token(token, context, event);
    }
    expression.clone()
}

fn resolve_path_token(token: &str, context: &Value, event: &Value) -> Value {
    if token == "$now" {
        return serde_json::Number::from_f64(js_sys::Date::now())
            .map(Value::Number)
            .unwrap_or(Value::Null);
    }
    if let Some(path) = token.strip_prefix("$event.") {
        return select_path(event, path).cloned().unwrap_or(Value::Null);
    }
    if let Some(path) = token.strip_prefix("$context.") {
        return select_path(context, path).cloned().unwrap_or(Value::Null);
    }
    if let Some(path) = token.strip_prefix("context.") {
        return select_path(context, path).cloned().unwrap_or(Value::Null);
    }
    select_path(context, token).cloned().unwrap_or(Value::Null)
}

fn collect_actions(
    definition: &Value,
    from: &str,
    target: &str,
    transition: &Value,
    event: &Value,
) -> Vec<Value> {
    let mut actions = Vec::new();

    if from != target {
        if let Some(node) = state_node(definition, from) {
            push_action_values(&mut actions, node.get("exit"), event);
        }
    }

    push_action_values(
        &mut actions,
        transition
            .get("action")
            .or_else(|| transition.get("actions")),
        event,
    );

    if from != target {
        if let Some(node) = state_node(definition, target) {
            push_action_values(&mut actions, node.get("entry"), event);
        }
    }

    actions
}

fn push_action_values(actions: &mut Vec<Value>, value: Option<&Value>, event: &Value) {
    let Some(value) = value else {
        return;
    };

    if let Some(name) = value.as_str() {
        actions.push(effect_descriptor(name, event));
        return;
    }

    if let Some(items) = value.as_array() {
        for item in items {
            if let Some(name) = item.as_str() {
                actions.push(effect_descriptor(name, event));
            } else if item.is_object() {
                actions.push(item.clone());
            }
        }
        return;
    }

    if value.is_object() {
        actions.push(value.clone());
    }
}

fn effect_descriptor(name: &str, event: &Value) -> Value {
    serde_json::json!({
        "id": next_id("effect"),
        "type": name,
        "payload": event.get("payload").cloned().unwrap_or_else(|| event.clone()),
        "permission": format!("effects:{name}"),
    })
}

fn history_limit(definition: &Value) -> usize {
    definition
        .get("historyLimit")
        .or_else(|| definition.pointer("/options/historyLimit"))
        .and_then(Value::as_u64)
        .map(|value| value as usize)
        .unwrap_or(100)
}

fn checkpoint_limit(definition: &Value) -> usize {
    definition
        .get("checkpointLimit")
        .or_else(|| definition.pointer("/options/checkpointLimit"))
        .and_then(Value::as_u64)
        .map(|value| value as usize)
        .unwrap_or_else(|| history_limit(definition))
}

fn now_ms() -> f64 {
    #[cfg(target_arch = "wasm32")]
    {
        js_sys::Date::now()
    }
    #[cfg(not(target_arch = "wasm32"))]
    {
        chrono::Utc::now().timestamp_millis() as f64
    }
}

fn select_path<'a>(value: &'a Value, path: &str) -> Option<&'a Value> {
    if path.is_empty() {
        return Some(value);
    }

    let mut current = value;
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

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn checkout_definition() -> Value {
        json!({
            "id": "checkout",
            "initial": "cart",
            "context": {
                "items": [{ "id": 1 }],
                "paymentId": null
            },
            "states": {
                "cart": {
                    "on": {
                        "NEXT": {
                            "target": "payment",
                            "guard": { "path": "items.0.id", "op": "exists" }
                        }
                    },
                    "exit": "leaveCart"
                },
                "payment": {
                    "entry": "enterPayment",
                    "on": {
                        "PAY": {
                            "target": "done",
                            "action": "requestPayment",
                            "assign": {
                                "paymentId": "$event.paymentId"
                            }
                        }
                    }
                },
                "done": {
                    "final": true
                }
            }
        })
    }

    #[test]
    fn transition_lookup_accepts_string_targets() {
        let state = json!({
            "on": {
                "NEXT": "review"
            }
        });

        let transition = transition_for_event(&state, "NEXT").unwrap();

        assert_eq!(transition["target"], "review");
    }

    #[test]
    fn object_guard_checks_context_paths() {
        let transition = json!({
            "guard": {
                "path": "items.0.id",
                "op": "exists"
            }
        });
        let context = json!({ "items": [{ "id": 1 }] });

        assert!(guard_allows(&transition, &context, &json!({ "type": "NEXT" })));
    }

    #[test]
    fn named_guard_reads_event_guard_results() {
        let transition = json!({ "guard": "hasItems" });
        let context = json!({});

        assert!(guard_allows(
            &transition,
            &context,
            &json!({ "type": "NEXT", "__guards": { "hasItems": true } })
        ));
        assert!(!guard_allows(
            &transition,
            &context,
            &json!({ "type": "NEXT", "__guards": { "hasItems": false } })
        ));
    }

    #[test]
    fn assign_patches_context_from_event() {
        let transition = json!({
            "assign": {
                "paymentId": "$event.paymentId",
                "meta.updatedAt": 123
            }
        });
        let mut context = json!({ "paymentId": null });

        apply_assign(&mut context, &transition, &json!({ "type": "PAY", "paymentId": "pay_1" }));

        assert_eq!(context["paymentId"], "pay_1");
        assert_eq!(context["meta"]["updatedAt"], 123);
    }

    #[test]
    fn actions_collect_exit_transition_and_entry_effects() {
        let definition = checkout_definition();
        let transition = definition["states"]["cart"]["on"]["NEXT"].clone();

        let actions = collect_actions(
            &definition,
            "cart",
            "payment",
            &transition,
            &json!({ "type": "NEXT" }),
        );

        let action_types: Vec<&str> = actions
            .iter()
            .filter_map(|action| action.get("type").and_then(Value::as_str))
            .collect();
        assert_eq!(action_types, vec!["leaveCart", "enterPayment"]);
    }

    #[test]
    fn final_state_is_detected_from_definition() {
        let definition = checkout_definition();

        assert!(is_final_state(&definition, "done"));
        assert!(!is_final_state(&definition, "payment"));
    }
}
