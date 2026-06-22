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
    validate_stores(
        &manifest,
        &host,
        &mut errors,
        &mut warnings,
        &mut isolated_stores,
    );
    validate_accelerators(&manifest, &host, &mut errors, &mut warnings);
    validate_deployment(&manifest, &host, &mut errors, &mut warnings);

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
    let required = manifest
        .pointer("/gaesup/abiVersion")
        .and_then(Value::as_str);
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
    for dependency in manifest
        .get("dependencies")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
    {
        let name = dependency.get("name").and_then(Value::as_str).unwrap_or("");
        let required = dependency
            .get("version")
            .and_then(Value::as_str)
            .unwrap_or("*");
        let source = dependency
            .get("source")
            .and_then(Value::as_str)
            .unwrap_or("host");
        let optional = dependency
            .get("optional")
            .and_then(Value::as_bool)
            .unwrap_or(false);

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
    for store in manifest
        .get("stores")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
    {
        let store_id = store.get("storeId").and_then(Value::as_str).unwrap_or("");
        let schema_id = store.get("schemaId").and_then(Value::as_str).unwrap_or("");
        let required = store
            .get("schemaVersion")
            .and_then(Value::as_str)
            .unwrap_or("*");
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
            Some((_provided_schema_id, provided_version)) if policy == "migrate" => {
                if has_schema_migration(&store) {
                    warnings.push(validation_issue(
                        "STORE_SCHEMA_MIGRATION_REQUIRED",
                        &format!("Store {store_id} requires migration before attaching: requires {required}, host provides {provided_version}"),
                        "warning",
                        store_id,
                    ));
                } else {
                    errors.push(validation_issue(
                        "STORE_SCHEMA_MIGRATION_MISSING",
                        &format!("Store {store_id} requested migrate policy but no migration was declared"),
                        "error",
                        store_id,
                    ));
                }
            }
            Some((_provided_schema_id, provided_version)) if policy == "readonly" => {
                warnings.push(validation_issue(
                    "STORE_SCHEMA_READONLY",
                    &format!("Store {store_id} schema mismatch will attach readonly: requires {required}, host provides {provided_version}"),
                    "warning",
                    store_id,
                ));
            }
            Some((_provided_schema_id, provided_version)) if policy == "shadow" => {
                isolated_stores.push(Value::String(store_id.to_string()));
                warnings.push(validation_issue(
                    "STORE_SCHEMA_SHADOWED",
                    &format!("Store {store_id} schema mismatch will run against shadow state: requires {required}, host provides {provided_version}"),
                    "warning",
                    store_id,
                ));
            }
            Some((_provided_schema_id, provided_version)) if policy == "dual-write" => {
                if has_dual_write_contract(&store) {
                    warnings.push(validation_issue(
                        "STORE_SCHEMA_DUAL_WRITE",
                        &format!("Store {store_id} schema mismatch will use dual-write: requires {required}, host provides {provided_version}"),
                        "warning",
                        store_id,
                    ));
                } else {
                    errors.push(validation_issue(
                        "STORE_SCHEMA_DUAL_WRITE_MISSING",
                        &format!("Store {store_id} requested dual-write policy but no dualWrite contract was declared"),
                        "error",
                        store_id,
                    ));
                }
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
            None if policy == "shadow" => {
                isolated_stores.push(Value::String(store_id.to_string()));
                warnings.push(validation_issue(
                    "STORE_SCHEMA_SHADOWED",
                    &format!("Store {store_id} has no host schema and will run against shadow state"),
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

fn has_schema_migration(store: &Value) -> bool {
    store.get("migration").is_some()
        || store
            .get("migrations")
            .and_then(Value::as_array)
            .is_some_and(|items| !items.is_empty())
}

fn has_dual_write_contract(store: &Value) -> bool {
    store.get("dualWrite").is_some()
        || store.get("dual-write").is_some()
        || store
            .get("writeSchemas")
            .and_then(Value::as_array)
            .is_some_and(|items| items.len() >= 2)
}

fn validate_accelerators(
    manifest: &Value,
    host: &Value,
    errors: &mut Vec<Value>,
    warnings: &mut Vec<Value>,
) {
    for accelerator in manifest
        .get("accelerators")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
    {
        let kind = accelerator
            .get("kind")
            .and_then(Value::as_str)
            .unwrap_or("");
        let required_version = accelerator.get("version").and_then(Value::as_str);
        let optional = accelerator
            .get("optional")
            .and_then(Value::as_bool)
            .unwrap_or(false);

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
                    &format!(
                        "Accelerator {kind} requires {required}, host provides {provided_version}"
                    ),
                    "error",
                    kind,
                ));
            }
        }

        let provided_capabilities = provided
            .get("capabilities")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        let required_capabilities = accelerator
            .get("capabilities")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        for capability in required_capabilities {
            let Some(capability) = capability.as_str() else {
                continue;
            };
            let found = provided_capabilities
                .iter()
                .any(|provided| provided.as_str() == Some(capability));
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

fn validate_deployment(
    manifest: &Value,
    host: &Value,
    errors: &mut Vec<Value>,
    warnings: &mut Vec<Value>,
) {
    let Some(deployment) = manifest.get("deployment") else {
        return;
    };

    let host_deployment = host.get("deployment");
    let manifest_release = deployment.get("releaseId").and_then(Value::as_str);
    let host_release = host_deployment
        .and_then(|deployment| deployment.get("releaseId"))
        .and_then(Value::as_str);
    let strict_release = host_deployment
        .and_then(|deployment| deployment.get("strictRelease"))
        .and_then(Value::as_bool)
        .unwrap_or(host_release.is_some());

    if strict_release {
        match (manifest_release, host_release) {
            (Some(required), Some(provided)) if required == provided => {}
            (Some(required), Some(provided)) => errors.push(validation_issue(
                "DEPLOYMENT_RELEASE_MISMATCH",
                &format!("Container release {required} does not match host release {provided}"),
                "error",
                "deployment.releaseId",
            )),
            (Some(_), None) => errors.push(validation_issue(
                "DEPLOYMENT_RELEASE_MISSING",
                "Container declares a releaseId but host has no deployment releaseId",
                "error",
                "deployment.releaseId",
            )),
            (None, Some(_)) => errors.push(validation_issue(
                "DEPLOYMENT_RELEASE_MISSING",
                "Host requires a deployment releaseId but container did not declare one",
                "error",
                "deployment.releaseId",
            )),
            (None, None) => {}
        }
    }

    if let Some(slot) = deployment.get("slot").and_then(Value::as_str) {
        if let Some(host_slot) = host_deployment.and_then(|host| host_slot(host, slot)) {
            let package_name = manifest.get("name").and_then(Value::as_str).unwrap_or("");
            let package_version = manifest
                .get("version")
                .and_then(Value::as_str)
                .unwrap_or("");
            let host_package = host_slot
                .get("packageName")
                .and_then(Value::as_str)
                .unwrap_or("");
            let host_version = host_slot
                .get("version")
                .and_then(Value::as_str)
                .unwrap_or("");

            if !host_package.is_empty() && !package_name.is_empty() && host_package != package_name
            {
                errors.push(validation_issue(
                    "DEPLOYMENT_SLOT_PACKAGE_MISMATCH",
                    &format!(
                        "Slot {slot} is pinned to {host_package}, container is {package_name}"
                    ),
                    "error",
                    slot,
                ));
            }

            if !host_version.is_empty()
                && !package_version.is_empty()
                && !version_satisfies(package_version, host_version)
            {
                errors.push(validation_issue(
                    "DEPLOYMENT_SLOT_VERSION_MISMATCH",
                    &format!("Slot {slot} requires package version {host_version}, container is {package_version}"),
                    "error",
                    slot,
                ));
            }
        }
    }

    for requirement in deployment
        .get("requires")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
    {
        let slot = requirement
            .get("slot")
            .and_then(Value::as_str)
            .unwrap_or("");
        if slot.is_empty() {
            warnings.push(validation_issue(
                "DEPLOYMENT_REQUIREMENT_IGNORED",
                "Deployment requirement without a slot was ignored",
                "warning",
                "deployment.requires",
            ));
            continue;
        }

        let Some(host_slot) = host_deployment.and_then(|host| host_slot(host, slot)) else {
            errors.push(validation_issue(
                "DEPLOYMENT_SLOT_MISSING",
                &format!("Required deployment slot {slot} is not registered on the host"),
                "error",
                slot,
            ));
            continue;
        };

        validate_slot_release(&requirement, &host_slot, slot, errors);
        validate_slot_version(&requirement, &host_slot, slot, errors);
        validate_slot_contract(&requirement, &host_slot, slot, errors);
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
                .then(|| {
                    item.get("version")
                        .and_then(Value::as_str)
                        .map(ToString::to_string)
                })
                .flatten()
        }),
        Value::Object(map) => map
            .get(name)
            .and_then(Value::as_str)
            .map(ToString::to_string),
        _ => None,
    }
}

fn host_store_schema(host: &Value, store_id: &str) -> Option<(String, String)> {
    host.get("stores")?.as_array()?.iter().find_map(|store| {
        if store.get("storeId").and_then(Value::as_str) == Some(store_id) {
            Some((
                store
                    .get("schemaId")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string(),
                store
                    .get("schemaVersion")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string(),
            ))
        } else {
            None
        }
    })
}

fn host_accelerator(host: &Value, kind: &str) -> Option<Value> {
    host.get("accelerators")?
        .as_array()?
        .iter()
        .find_map(|accelerator| {
            (accelerator.get("kind").and_then(Value::as_str) == Some(kind))
                .then(|| accelerator.clone())
        })
}

fn host_slot(host_deployment: &Value, slot: &str) -> Option<Value> {
    host_deployment
        .get("slots")?
        .as_array()?
        .iter()
        .find_map(|item| {
            (item.get("slot").and_then(Value::as_str) == Some(slot)).then(|| item.clone())
        })
}

fn validate_slot_release(
    requirement: &Value,
    host_slot: &Value,
    slot: &str,
    errors: &mut Vec<Value>,
) {
    let required = requirement.get("releaseId").and_then(Value::as_str);
    let provided = host_slot.get("releaseId").and_then(Value::as_str);
    if let (Some(required), Some(provided)) = (required, provided) {
        if required != provided {
            errors.push(validation_issue(
                "DEPLOYMENT_SLOT_RELEASE_MISMATCH",
                &format!(
                    "Slot {slot} release {provided} does not match required release {required}"
                ),
                "error",
                slot,
            ));
        }
    }
}

fn validate_slot_version(
    requirement: &Value,
    host_slot: &Value,
    slot: &str,
    errors: &mut Vec<Value>,
) {
    let required = requirement.get("slotVersion").and_then(Value::as_str);
    let provided = host_slot.get("slotVersion").and_then(Value::as_str);
    if let (Some(required), Some(provided)) = (required, provided) {
        if !version_satisfies(provided, required) {
            errors.push(validation_issue(
                "DEPLOYMENT_SLOT_VERSION_MISMATCH",
                &format!("Slot {slot} version {provided} does not satisfy {required}"),
                "error",
                slot,
            ));
        }
    }
}

fn validate_slot_contract(
    requirement: &Value,
    host_slot: &Value,
    slot: &str,
    errors: &mut Vec<Value>,
) {
    let required = requirement.get("contractVersion").and_then(Value::as_str);
    let provided = host_slot.get("contractVersion").and_then(Value::as_str);
    if let (Some(required), Some(provided)) = (required, provided) {
        if !version_satisfies(provided, required) {
            errors.push(validation_issue(
                "DEPLOYMENT_SLOT_CONTRACT_MISMATCH",
                &format!("Slot {slot} contract {provided} does not satisfy {required}"),
                "error",
                slot,
            ));
        }
    }
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
        return provided.0 == base.0
            && provided.1 == base.1
            && compare_version(provided, base) >= 0;
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
    Some((
        numbers.next()??,
        numbers.next()??,
        numbers.next().flatten().unwrap_or(0),
    ))
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
    fn schema_conflict_with_migrate_requires_declared_migration() {
        let manifest = json!({
            "stores": [
                {
                    "storeId": "orders",
                    "schemaId": "orders-state",
                    "schemaVersion": "^2.0.0",
                    "conflictPolicy": "migrate",
                    "migrations": [{ "from": "1.x", "to": "2.0.0", "name": "ordersV2" }]
                }
            ]
        });
        let host = json!({
            "stores": [
                { "storeId": "orders", "schemaId": "orders-state", "schemaVersion": "1.2.0" }
            ]
        });
        let mut errors = vec![];
        let mut warnings = vec![];
        let mut isolated = vec![];

        validate_stores(&manifest, &host, &mut errors, &mut warnings, &mut isolated);

        assert!(errors.is_empty());
        assert_eq!(warnings[0]["code"], "STORE_SCHEMA_MIGRATION_REQUIRED");
        assert!(isolated.is_empty());
    }

    #[test]
    fn migrate_policy_without_migration_is_error() {
        let manifest = json!({
            "stores": [
                {
                    "storeId": "orders",
                    "schemaId": "orders-state",
                    "schemaVersion": "^2.0.0",
                    "conflictPolicy": "migrate"
                }
            ]
        });
        let host = json!({
            "stores": [
                { "storeId": "orders", "schemaId": "orders-state", "schemaVersion": "1.2.0" }
            ]
        });
        let mut errors = vec![];
        let mut warnings = vec![];
        let mut isolated = vec![];

        validate_stores(&manifest, &host, &mut errors, &mut warnings, &mut isolated);

        assert_eq!(errors[0]["code"], "STORE_SCHEMA_MIGRATION_MISSING");
        assert!(warnings.is_empty());
    }

    #[test]
    fn readonly_shadow_and_dual_write_policies_are_reported() {
        let manifest = json!({
            "stores": [
                {
                    "storeId": "readonly-orders",
                    "schemaId": "orders-state",
                    "schemaVersion": "^2.0.0",
                    "conflictPolicy": "readonly"
                },
                {
                    "storeId": "shadow-orders",
                    "schemaId": "orders-state",
                    "schemaVersion": "^2.0.0",
                    "conflictPolicy": "shadow"
                },
                {
                    "storeId": "dual-orders",
                    "schemaId": "orders-state",
                    "schemaVersion": "^2.0.0",
                    "conflictPolicy": "dual-write",
                    "writeSchemas": ["1.x", "2.x"]
                }
            ]
        });
        let host = json!({
            "stores": [
                { "storeId": "readonly-orders", "schemaId": "orders-state", "schemaVersion": "1.2.0" },
                { "storeId": "shadow-orders", "schemaId": "orders-state", "schemaVersion": "1.2.0" },
                { "storeId": "dual-orders", "schemaId": "orders-state", "schemaVersion": "1.2.0" }
            ]
        });
        let mut errors = vec![];
        let mut warnings = vec![];
        let mut isolated = vec![];

        validate_stores(&manifest, &host, &mut errors, &mut warnings, &mut isolated);

        let codes: Vec<&str> = warnings
            .iter()
            .filter_map(|issue| issue.get("code").and_then(Value::as_str))
            .collect();
        assert!(errors.is_empty());
        assert_eq!(
            codes,
            vec![
                "STORE_SCHEMA_READONLY",
                "STORE_SCHEMA_SHADOWED",
                "STORE_SCHEMA_DUAL_WRITE"
            ]
        );
        assert_eq!(isolated, vec![Value::String("shadow-orders".to_string())]);
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
    fn deployment_release_mismatch_is_error() {
        let manifest = json!({
            "name": "body-widget",
            "version": "1.0.0",
            "deployment": {
                "slot": "body",
                "releaseId": "release-b"
            }
        });
        let host = json!({
            "deployment": {
                "releaseId": "release-a",
                "strictRelease": true,
                "slots": [
                    { "slot": "header", "releaseId": "release-a", "slotVersion": "1.2.0", "contractVersion": "1.0.0" }
                ]
            }
        });
        let mut errors = vec![];
        let mut warnings = vec![];

        validate_deployment(&manifest, &host, &mut errors, &mut warnings);

        assert_eq!(errors[0]["code"], "DEPLOYMENT_RELEASE_MISMATCH");
        assert!(warnings.is_empty());
    }

    #[test]
    fn deployment_requires_peer_slot_contract() {
        let manifest = json!({
            "name": "body-widget",
            "version": "1.0.0",
            "deployment": {
                "slot": "body",
                "releaseId": "release-a",
                "requires": [
                    { "slot": "header", "releaseId": "release-a", "slotVersion": "^1.2.0", "contractVersion": "^1.0.0" }
                ]
            }
        });
        let host = json!({
            "deployment": {
                "releaseId": "release-a",
                "slots": [
                    { "slot": "header", "releaseId": "release-a", "slotVersion": "1.3.0", "contractVersion": "1.1.0" }
                ]
            }
        });
        let mut errors = vec![];
        let mut warnings = vec![];

        validate_deployment(&manifest, &host, &mut errors, &mut warnings);

        assert!(errors.is_empty());
        assert!(warnings.is_empty());
    }

    #[test]
    fn deployment_blocks_old_peer_slot_contract() {
        let manifest = json!({
            "name": "body-widget",
            "version": "1.0.0",
            "deployment": {
                "slot": "body",
                "releaseId": "release-a",
                "requires": [
                    { "slot": "header", "slotVersion": "^2.0.0", "contractVersion": "^2.0.0" }
                ]
            }
        });
        let host = json!({
            "deployment": {
                "releaseId": "release-a",
                "slots": [
                    { "slot": "header", "releaseId": "release-a", "slotVersion": "1.3.0", "contractVersion": "1.1.0" }
                ]
            }
        });
        let mut errors = vec![];
        let mut warnings = vec![];

        validate_deployment(&manifest, &host, &mut errors, &mut warnings);

        assert_eq!(errors.len(), 2);
        assert_eq!(errors[0]["code"], "DEPLOYMENT_SLOT_VERSION_MISMATCH");
        assert_eq!(errors[1]["code"], "DEPLOYMENT_SLOT_CONTRACT_MISMATCH");
    }

    #[test]
    fn version_ranges_are_checked() {
        assert!(version_satisfies("2.30.0", "^2.29.0"));
        assert!(!version_satisfies("3.0.0", "^2.29.0"));
        assert!(version_satisfies("12.4.0", ">=12.0.0"));
        assert!(!version_satisfies("11.8.0", ">=12.0.0"));
    }
}
