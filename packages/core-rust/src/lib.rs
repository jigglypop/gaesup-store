use serde::Serialize;
use serde_json::Value;
use std::cell::RefCell;
use wasm_bindgen::prelude::*;

mod compatibility;
mod container;
mod store;

#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_namespace = console)]
    fn log(message: &str);
}

thread_local! {
    static ID_COUNTER: RefCell<u64> = const { RefCell::new(0) };
}

#[wasm_bindgen(start)]
pub fn init() {
    console_error_panic_hook::set_once();
    log("Gaesup-State Rust WASM Core initialized");
}

pub(crate) fn next_id(prefix: &str) -> String {
    ID_COUNTER.with(|counter| {
        let mut counter = counter.borrow_mut();
        *counter += 1;
        format!("{prefix}_{}_{}", js_sys::Date::now() as u64, *counter)
    })
}

pub(crate) fn from_js(value: JsValue) -> Result<Value, JsValue> {
    if value.is_undefined() {
        return Ok(Value::Null);
    }

    serde_wasm_bindgen::from_value(value)
        .map_err(|error| js_error(&format!("Deserialization error: {error}")))
}

pub(crate) fn to_js<T: Serialize + ?Sized>(value: &T) -> Result<JsValue, JsValue> {
    value.serialize(&serde_wasm_bindgen::Serializer::json_compatible())
        .map_err(|error| js_error(&format!("Serialization error: {error}")))
}

pub(crate) fn js_error(message: &str) -> JsValue {
    JsValue::from_str(message)
}

pub(crate) fn json_number(value: f64) -> Value {
    serde_json::Number::from_f64(value)
        .map(Value::Number)
        .unwrap_or(Value::Null)
}
