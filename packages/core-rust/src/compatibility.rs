use serde::Serialize;
use serde_json::Value;
use wasm_bindgen::prelude::*;

use crate::{from_js, to_js};

#[wasm_bindgen]
pub fn validate_manifest(manifest: JsValue, host: JsValue) -> Result<JsValue, JsValue> {
    let manifest = from_js(manifest)?;
    let host = from_js(host)?;
    let mut errors: Vec<Value> = Vec::new();
    let mut warnings: Vec<Value> = Vec::new();
    let mut isolated_stores: Vec<Value> = Vec::new();

    validate_abi(&manifest, &host, &mut errors);
    validate_dependencies(&manifest, &host, &mut errors, &mut warnings);
    validate_stores(&manifest, &host, &mut errors, &mut warnings, &mut isolated_stores);
    validate_accelerators(&manifest, &host, &mut errors, &mut warnings);

    to_js(&ValidationResult {
        valid: errors.is_empty(),
        errors,
        warnings,
        isolated_stores,
    })
}

#[derive(Serialize)]
struct ValidationResult {
    valid: bool,
    errors: Vec<Value>,
    warnings: Vec<Value>,
    #[serde(rename = "isolatedStores")]
    isolated_stores: Vec<Value>,
}

fn validate_abi(manifest: &Value, host: &Value, errors: &mut Vec<Value>) {
    let required = manifest.pointer("/gaesup/abiVersion").and_then(Value::as_str);
    let provided = host.get("abiVersion").and_then(Value::as_str);
    if let (Some(required), Some(provided)) = (required, provided) {
        if !version_satisfies(provided, required) {
            errors.push(validation_issue(
                "ABI_VERSION_MISMATCH",
                &format!("ABI {required} is required, host provides {provided}"),
                "error",
                "gaesup.abiVersion",
            ));
        }
    }
}

fn validate_dependencies(
    manifest: &Value,
    host: &Value,
    errors: &mut Vec<Value>,
    warnings: &mut Vec<Value>,
) {
    for dependency in manifest.get("dependencies").and_then(Value::as_array).cloned().unwrap_or_default() {
        let name = dependency.get("name").and_then(Value::as_str).unwrap_or("");
        let required = dependency.get("version").and_then(Value::as_str).unwrap_or("*");
        let source = dependency.get("source").and_then(Value::as_str).unwrap_or("host");
        let optional = dependency.get("optional").and_then(Value::as_bool).unwrap_or(false);

        if source == "bundled" {
            warnings.push(validation_issue(
                "PACKAGE_DEPENDENCY_BUNDLED",
                &format!("Dependency {name}@{required} is bundled with the container"),
                "warning",
                name,
            ));
            continue;
        }

        match host_dependency_version(host, name) {
            Some(provided) if version_satisfies(&provided, required) => {}
            Some(provided) => errors.push(validation_issue(
                "PACKAGE_DEPENDENCY_VERSION_MISMATCH",
                &format!("Dependency {name} requires {required}, host provides {provided}"),
                "error",
                name,
            )),
            None if optional => {}
            None => errors.push(validation_issue(
                "PACKAGE_DEPENDENCY_MISSING",
                &format!("Dependency {name} is required but host does not provide it"),
                "error",
                name,
            )),
        }
    }
}

fn validate_stores(
    manifest: &Value,
    host: &Value,
    errors: &mut Vec<Value>,
    warnings: &mut Vec<Value>,
    isolated_stores: &mut Vec<Value>,
) {
    for store in manifest.get("stores").and_then(Value::as_array).cloned().unwrap_or_default() {
        let store_id = store.get("storeId").and_then(Value::as_str).unwrap_or("");
        let schema_id = store.get("schemaId").and_then(Value::as_str).unwrap_or("");
        let required = store.get("schemaVersion").and_then(Value::as_str).unwrap_or("*");
        let policy = store
            .get("conflictPolicy")
            .and_then(Value::as_str)
            .or_else(|| host.get("defaultConflictPolicy").and_then(Value::as_str))
            .unwrap_or("reject");

        match host_store_schema(host, store_id) {
            Some((provided_schema_id, provided_version))
                if provided_schema_id == schema_id && version_satisfies(&provided_version, required) => {}
            Some((_provided_schema_id, provided_version)) if policy == "isolate" => {
                isolated_stores.push(Value::String(store_id.to_string()));
                warnings.push(validation_issue(
                    "STORE_SCHEMA_ISOLATED",
                    &format!("Store {store_id} schema version mismatch: requires {required}, host provides {provided_version}"),
                    "warning",
                    store_id,
                ));
            }
            Some((_provided_schema_id, provided_version)) => errors.push(validation_issue(
                "STORE_SCHEMA_CONFLICT",
                &format!("Store {store_id} schema version mismatch: requires {required}, host provides {provided_version}"),
                "error",
                store_id,
            )),
            None if policy == "isolate" => {
                isolated_stores.push(Value::String(store_id.to_string()));
                warnings.push(validation_issue(
                    "STORE_SCHEMA_ISOLATED",
                    &format!("Store {store_id} has no host schema and will be isolated"),
                    "warning",
                    store_id,
                ));
            }
            None => errors.push(validation_issue(
                "STORE_SCHEMA_MISSING",
                &format!("Store {store_id} is required but host has no registered schema"),
                "error",
                store_id,
            )),
        }
    }
}

fn validate_accelerators(
    manifest: &Value,
    host: &Value,
    errors: &mut Vec<Value>,
    warnings: &mut Vec<Value>,
) {
    for accelerator in manifest.get("accelerators").and_then(Value::as_array).cloned().unwrap_or_default() {
        let kind = accelerator.get("kind").and_then(Value::as_str).unwrap_or("");
        let required_version = accelerator.get("version").and_then(Value::as_str);
        let optional = accelerator.get("optional").and_then(Value::as_bool).unwrap_or(false);

        let Some(provided) = host_accelerator(host, kind) else {
            let output = validation_issue(
                "ACCELERATOR_MISSING",
                &format!("Accelerator {kind} is required but host/runtime does not provide it"),
                if optional { "warning" } else { "error" },
                kind,
            );
            if optional {
                warnings.push(output);
            } else {
                errors.push(output);
            }
            continue;
        };

        if let (Some(required), Some(provided_version)) = (
            required_version,
            provided.get("version").and_then(Value::as_str),
        ) {
            if !version_satisfies(provided_version, required) {
                errors.push(validation_issue(
                    "ACCELERATOR_VERSION_MISMATCH",
                    &format!("Accelerator {kind} requires {required}, host provides {provided_version}"),
                    "error",
                    kind,
                ));
            }
        }

        let provided_capabilities = provided.get("capabilities").and_then(Value::as_array).cloned().unwrap_or_default();
        let required_capabilities = accelerator.get("capabilities").and_then(Value::as_array).cloned().unwrap_or_default();
        for capability in required_capabilities {
            let Some(capability) = capability.as_str() else {
                continue;
            };
            let found = provided_capabilities.iter().any(|provided| provided.as_str() == Some(capability));
            if !found {
                errors.push(validation_issue(
                    "ACCELERATOR_CAPABILITY_MISSING",
                    &format!("Accelerator {kind} requires capability {capability}"),
                    "error",
                    kind,
                ));
            }
        }
    }
}

fn validation_issue(code: &str, message: &str, severity: &str, target: &str) -> Value {
    serde_json::json!({
        "code": code,
        "message": message,
        "severity": severity,
        "target": target,
    })
}

fn host_dependency_version(host: &Value, name: &str) -> Option<String> {
    match host.get("dependencies")? {
        Value::Array(items) => items.iter().find_map(|item| {
            (item.get("name").and_then(Value::as_str) == Some(name))
                .then(|| item.get("version").and_then(Value::as_str).map(ToString::to_string))
                .flatten()
        }),
        Value::Object(map) => map.get(name).and_then(Value::as_str).map(ToString::to_string),
        _ => None,
    }
}

fn host_store_schema(host: &Value, store_id: &str) -> Option<(String, String)> {
    host.get("stores")?.as_array()?.iter().find_map(|store| {
        if store.get("storeId").and_then(Value::as_str) == Some(store_id) {
            Some((
                store.get("schemaId").and_then(Value::as_str).unwrap_or("").to_string(),
                store.get("schemaVersion").and_then(Value::as_str).unwrap_or("").to_string(),
            ))
        } else {
            None
        }
    })
}

fn host_accelerator(host: &Value, kind: &str) -> Option<Value> {
    host.get("accelerators")?.as_array()?.iter().find_map(|accelerator| {
        (accelerator.get("kind").and_then(Value::as_str) == Some(kind)).then(|| accelerator.clone())
    })
}

fn version_satisfies(provided: &str, required: &str) -> bool {
    if required.is_empty() || required == "*" {
        return true;
    }
    let Some(provided) = parse_version(provided) else {
        return provided == required;
    };

    if let Some(base) = required.strip_prefix('^').and_then(parse_version) {
        return provided.0 == base.0 && compare_version(provided, base) >= 0;
    }
    if let Some(base) = required.strip_prefix(">=").and_then(parse_version) {
        return compare_version(provided, base) >= 0;
    }
    if let Some(base) = required.strip_prefix('~').and_then(parse_version) {
        return provided.0 == base.0 && provided.1 == base.1 && compare_version(provided, base) >= 0;
    }
    parse_version(required)
        .map(|base| compare_version(provided, base) == 0)
        .unwrap_or(false)
}

fn parse_version(version: &str) -> Option<(i32, i32, i32)> {
    let mut numbers = version
        .split(|character: char| !character.is_ascii_digit())
        .filter(|part| !part.is_empty())
        .take(3)
        .map(|part| part.parse::<i32>().ok());
    Some((numbers.next()??, numbers.next()??, numbers.next().flatten().unwrap_or(0)))
}

fn compare_version(left: (i32, i32, i32), right: (i32, i32, i32)) -> i32 {
    let major = left.0 - right.0;
    if major != 0 {
        return major;
    }
    let minor = left.1 - right.1;
    if minor != 0 {
        return minor;
    }
    left.2 - right.2
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn bundled_dependency_is_warning_not_error() {
        let manifest = json!({
            "dependencies": [
                { "name": "chart.js", "version": "^3.9.0", "source": "bundled" }
            ]
        });
        let host = json!({
            "dependencies": [
                { "name": "chart.js", "version": "4.4.3" }
            ]
        });
        let mut errors = vec![];
        let mut warnings = vec![];

        validate_dependencies(&manifest, &host, &mut errors, &mut warnings);

        assert!(errors.is_empty());
        assert_eq!(warnings[0]["code"], "PACKAGE_DEPENDENCY_BUNDLED");
    }

    #[test]
    fn host_dependency_major_mismatch_is_error() {
        let manifest = json!({
            "dependencies": [
                { "name": "chart.js", "version": "^3.9.0", "source": "host" }
            ]
        });
        let host = json!({
            "dependencies": [
                { "name": "chart.js", "version": "4.4.3" }
            ]
        });
        let mut errors = vec![];
        let mut warnings = vec![];

        validate_dependencies(&manifest, &host, &mut errors, &mut warnings);

        assert_eq!(errors[0]["code"], "PACKAGE_DEPENDENCY_VERSION_MISMATCH");
        assert!(warnings.is_empty());
    }

    #[test]
    fn schema_conflict_with_isolate_policy_is_not_error() {
        let manifest = json!({
            "stores": [
                {
                    "storeId": "orders",
                    "schemaId": "orders-state",
                    "schemaVersion": "^2.0.0",
                    "conflictPolicy": "isolate"
                }
            ]
        });
        let host = json!({
            "stores": [
                {
                    "storeId": "orders",
                    "schemaId": "orders-state",
                    "schemaVersion": "1.2.0"
                }
            ]
        });
        let mut errors = vec![];
        let mut warnings = vec![];
        let mut isolated = vec![];

        validate_stores(&manifest, &host, &mut errors, &mut warnings, &mut isolated);

        assert!(errors.is_empty());
        assert_eq!(warnings[0]["code"], "STORE_SCHEMA_ISOLATED");
        assert_eq!(isolated, vec![Value::String("orders".to_string())]);
    }

    #[test]
    fn accelerator_capability_missing_is_error() {
        let manifest = json!({
            "accelerators": [
                { "kind": "cuda", "version": ">=12.0.0", "capabilities": ["sm_90"] }
            ]
        });
        let host = json!({
            "accelerators": [
                { "kind": "cuda", "version": "12.4.0", "capabilities": ["sm_80"] }
            ]
        });
        let mut errors = vec![];
        let mut warnings = vec![];

        validate_accelerators(&manifest, &host, &mut errors, &mut warnings);

        assert_eq!(errors[0]["code"], "ACCELERATOR_CAPABILITY_MISSING");
        assert!(warnings.is_empty());
    }

    #[test]
    fn version_ranges_are_checked() {
        assert!(version_satisfies("2.30.0", "^2.29.0"));
        assert!(!version_satisfies("3.0.0", "^2.29.0"));
        assert!(version_satisfies("12.4.0", ">=12.0.0"));
        assert!(!version_satisfies("11.8.0", ">=12.0.0"));
    }
}
