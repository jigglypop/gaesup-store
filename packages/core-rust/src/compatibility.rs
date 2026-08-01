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
    validate_integrity(&manifest, &host, &mut errors);
    validate_signature(&manifest, &host, &mut errors);
    validate_allowed_imports(&manifest, &host, &mut errors);
    validate_permissions(&manifest, &host, &mut errors);
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

fn validate_integrity(manifest: &Value, host: &Value, errors: &mut Vec<Value>) {
    let hash = manifest.pointer("/integrity/hash").and_then(Value::as_str);
    let require_integrity = host
        .get("requireIntegrity")
        .and_then(Value::as_bool)
        .unwrap_or(false);

    match hash {
        Some(hash) if !hash.is_empty() => {
            if !integrity_hash_is_well_formed(hash) {
                errors.push(validation_issue(
                    "MANIFEST_HASH_INVALID",
                    &format!("Integrity hash {hash} is not a valid <algo>-<hexdigest> value"),
                    "error",
                    "integrity.hash",
                ));
            }
        }
        _ if require_integrity => errors.push(validation_issue(
            "MANIFEST_INTEGRITY_MISSING",
            "Host requires manifest integrity but no integrity.hash was declared",
            "error",
            "integrity.hash",
        )),
        _ => {}
    }
}

fn validate_signature(manifest: &Value, host: &Value, errors: &mut Vec<Value>) {
    let signature = manifest
        .pointer("/integrity/signature")
        .and_then(Value::as_str);
    let require_signature = host
        .get("requireSignature")
        .and_then(Value::as_bool)
        .unwrap_or(false);

    match signature {
        Some(signature) if !signature.is_empty() => {
            if !integrity_signature_is_well_formed(signature) {
                errors.push(validation_issue(
                    "MANIFEST_SIGNATURE_INVALID",
                    &format!(
                        "Integrity signature {signature} is not a valid <scheme>-<base64payload> value"
                    ),
                    "error",
                    "integrity.signature",
                ));
            }
        }
        _ if require_signature => errors.push(validation_issue(
            "MANIFEST_SIGNATURE_MISSING",
            "Host requires a manifest signature but no integrity.signature was declared",
            "error",
            "integrity.signature",
        )),
        _ => {}
    }
}

fn validate_allowed_imports(manifest: &Value, host: &Value, errors: &mut Vec<Value>) {
    let Some(declared) = manifest.get("allowedImports") else {
        return;
    };
    let Some(entries) = declared.as_array() else {
        errors.push(validation_issue(
            "MANIFEST_IMPORTS_INVALID",
            "allowedImports must be an array of non-empty strings",
            "error",
            "allowedImports",
        ));
        return;
    };
    let host_allowlist: Option<Vec<&str>> = host
        .get("allowedImports")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(str::trim)
                .collect()
        });

    for entry in entries {
        let import = entry.as_str().map(str::trim).filter(|item| !item.is_empty());
        let Some(import) = import else {
            errors.push(validation_issue(
                "MANIFEST_IMPORTS_INVALID",
                "allowedImports entries must be non-empty strings",
                "error",
                "allowedImports",
            ));
            continue;
        };
        if let Some(allowlist) = &host_allowlist {
            if !allowlist.contains(&import) {
                errors.push(validation_issue(
                    "IMPORT_NOT_ALLOWED",
                    &format!("Import {import} is not allowed by the host import allowlist"),
                    "error",
                    import,
                ));
            }
        }
    }
}

const KNOWN_PERMISSION_CAPABILITIES: [&str; 6] = [
    "network",
    "storage",
    "dom",
    "crossStore",
    "crossContainer",
    "effects",
];

fn validate_permissions(manifest: &Value, host: &Value, errors: &mut Vec<Value>) {
    let Some(declared) = manifest.get("permissions") else {
        return;
    };
    let Some(entries) = declared.as_object() else {
        errors.push(validation_issue(
            "MANIFEST_PERMISSIONS_INVALID",
            "permissions must be an object keyed by capability name",
            "error",
            "permissions",
        ));
        return;
    };
    let host_allowlist: Option<Vec<&str>> = host
        .get("allowedPermissions")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(str::trim)
                .collect()
        });

    for (capability, value) in entries {
        let target = format!("permissions.{capability}");
        if !KNOWN_PERMISSION_CAPABILITIES.contains(&capability.as_str()) {
            errors.push(validation_issue(
                "PERMISSION_UNKNOWN_CAPABILITY",
                &format!(
                    "Permission capability {capability} is not in the known capability registry ({})",
                    KNOWN_PERMISSION_CAPABILITIES.join(", ")
                ),
                "error",
                &target,
            ));
            continue;
        }
        if !permission_is_requested(value) {
            continue;
        }
        if let Some(allowlist) = &host_allowlist {
            if !allowlist.contains(&capability.as_str()) {
                errors.push(validation_issue(
                    "PERMISSION_NOT_GRANTED",
                    &format!(
                        "Permission capability {capability} is requested but not granted by the host"
                    ),
                    "error",
                    &target,
                ));
            }
        }
    }
}

fn permission_is_requested(value: &Value) -> bool {
    match value {
        Value::Bool(enabled) => *enabled,
        Value::String(mode) => mode != "none",
        Value::Array(items) => !items.is_empty(),
        Value::Object(map) => {
            map.get("enabled").and_then(Value::as_bool) != Some(false)
                && map.get("mode").and_then(Value::as_str) != Some("none")
        }
        _ => true,
    }
}

const SIGNATURE_SCHEMES: [&str; 3] = ["ed25519", "ecdsa-p256", "rsa-sha256"];

fn integrity_signature_is_well_formed(signature: &str) -> bool {
    SIGNATURE_SCHEMES
        .iter()
        .find_map(|scheme| {
            signature
                .strip_prefix(scheme)
                .and_then(|rest| rest.strip_prefix('-'))
        })
        .is_some_and(signature_payload_is_base64)
}

fn signature_payload_is_base64(payload: &str) -> bool {
    if payload.is_empty() || payload.len() % 4 != 0 {
        return false;
    }
    let body = payload.trim_end_matches('=');
    payload.len() - body.len() <= 2
        && !body.is_empty()
        && body
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || character == '+' || character == '/')
}

fn integrity_hash_is_well_formed(hash: &str) -> bool {
    let Some((algorithm, digest)) = hash.split_once('-') else {
        return false;
    };
    let expected_length = match algorithm {
        "sha256" => 64,
        "sha384" => 96,
        "sha512" => 128,
        _ => return false,
    };
    digest.len() == expected_length
        && digest.chars().all(|character| character.is_ascii_hexdigit())
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
    fn integrity_hash_with_valid_sha256_passes() {
        let manifest = json!({
            "integrity": { "hash": format!("sha256-{}", "a1B2c3D4".repeat(8)) }
        });
        let host = json!({ "requireIntegrity": true });
        let mut errors = vec![];

        validate_integrity(&manifest, &host, &mut errors);

        assert!(errors.is_empty());
    }

    #[test]
    fn integrity_hash_with_bad_format_is_rejected() {
        let non_hex_digest = format!("sha256-{}", "g".repeat(64));
        let missing_algorithm = "0".repeat(64);
        for bad_hash in [
            "sha256-zz",
            "md5-0123456789abcdef",
            "not-a-hash",
            non_hex_digest.as_str(),
            missing_algorithm.as_str(),
        ] {
            let manifest = json!({ "integrity": { "hash": bad_hash } });
            let host = json!({});
            let mut errors = vec![];

            validate_integrity(&manifest, &host, &mut errors);

            assert_eq!(errors[0]["code"], "MANIFEST_HASH_INVALID", "{bad_hash}");
            assert_eq!(errors[0]["target"], "integrity.hash");
        }
    }

    #[test]
    fn missing_integrity_hash_is_error_when_host_requires_integrity() {
        let manifest = json!({ "name": "shop-body" });
        let host = json!({ "requireIntegrity": true });
        let mut errors = vec![];

        validate_integrity(&manifest, &host, &mut errors);

        assert_eq!(errors[0]["code"], "MANIFEST_INTEGRITY_MISSING");
        assert_eq!(errors[0]["target"], "integrity.hash");
    }

    #[test]
    fn empty_integrity_hash_is_error_when_host_requires_integrity() {
        let manifest = json!({ "integrity": { "hash": "" } });
        let host = json!({ "requireIntegrity": true });
        let mut errors = vec![];

        validate_integrity(&manifest, &host, &mut errors);

        assert_eq!(errors[0]["code"], "MANIFEST_INTEGRITY_MISSING");
    }

    #[test]
    fn missing_integrity_hash_passes_when_host_does_not_require_integrity() {
        let manifest = json!({ "name": "shop-body" });
        let host = json!({});
        let mut errors = vec![];

        validate_integrity(&manifest, &host, &mut errors);

        assert!(errors.is_empty());
    }

    #[test]
    fn integrity_signature_with_valid_scheme_and_base64_payload_passes() {
        for good_signature in [
            "ed25519-dGVzdC1zaWduYXR1cmU=",
            "ecdsa-p256-QUJDRA==",
            "rsa-sha256-QUJDRA==",
        ] {
            let manifest = json!({ "integrity": { "signature": good_signature } });
            let host = json!({ "requireSignature": true });
            let mut errors = vec![];

            validate_signature(&manifest, &host, &mut errors);

            assert!(errors.is_empty(), "{good_signature}");
        }
    }

    #[test]
    fn integrity_signature_with_bad_format_is_rejected() {
        for bad_signature in [
            "md5-QUJDRA==",
            "QUJDRA==",
            "ed25519-",
            "ed25519-not_base64!",
            "ed25519-abc",
            "ed25519-====",
        ] {
            let manifest = json!({ "integrity": { "signature": bad_signature } });
            let host = json!({});
            let mut errors = vec![];

            validate_signature(&manifest, &host, &mut errors);

            assert_eq!(errors[0]["code"], "MANIFEST_SIGNATURE_INVALID", "{bad_signature}");
            assert_eq!(errors[0]["target"], "integrity.signature");
        }
    }

    #[test]
    fn missing_integrity_signature_is_error_when_host_requires_signature() {
        let manifest = json!({ "integrity": { "signature": "" } });
        let host = json!({ "requireSignature": true });
        let mut errors = vec![];

        validate_signature(&manifest, &host, &mut errors);

        assert_eq!(errors[0]["code"], "MANIFEST_SIGNATURE_MISSING");
        assert_eq!(errors[0]["target"], "integrity.signature");
    }

    #[test]
    fn missing_integrity_signature_passes_when_host_does_not_require_signature() {
        let manifest = json!({ "name": "shop-body" });
        let host = json!({ "requireIntegrity": true });
        let mut errors = vec![];

        validate_signature(&manifest, &host, &mut errors);

        assert!(errors.is_empty());
    }

    #[test]
    fn imports_within_host_allowlist_pass() {
        let manifest = json!({ "allowedImports": ["env.log", "wasi_snapshot_preview1"] });
        let host = json!({ "allowedImports": ["env.log", "wasi_snapshot_preview1", "env.now"] });
        let mut errors = vec![];

        validate_allowed_imports(&manifest, &host, &mut errors);

        assert!(errors.is_empty());
    }

    #[test]
    fn imports_missing_from_host_allowlist_get_one_error_per_import() {
        let manifest = json!({ "allowedImports": ["env.fetch", "env.exec"] });
        let host = json!({ "allowedImports": ["env.log"] });
        let mut errors = vec![];

        validate_allowed_imports(&manifest, &host, &mut errors);

        assert_eq!(errors.len(), 2);
        assert_eq!(errors[0]["code"], "IMPORT_NOT_ALLOWED");
        assert_eq!(errors[0]["target"], "env.fetch");
        assert!(errors[0]["message"]
            .as_str()
            .unwrap()
            .contains("env.fetch"));
        assert_eq!(errors[1]["code"], "IMPORT_NOT_ALLOWED");
        assert_eq!(errors[1]["target"], "env.exec");
    }

    #[test]
    fn blank_import_entry_is_rejected_as_invalid() {
        let manifest = json!({ "allowedImports": ["env.log", "   "] });
        let host = json!({});
        let mut errors = vec![];

        validate_allowed_imports(&manifest, &host, &mut errors);

        assert_eq!(errors[0]["code"], "MANIFEST_IMPORTS_INVALID");
        assert_eq!(errors[0]["target"], "allowedImports");
    }

    #[test]
    fn non_string_import_entry_is_rejected_as_invalid() {
        let manifest = json!({ "allowedImports": ["env.log", 42] });
        let host = json!({});
        let mut errors = vec![];

        validate_allowed_imports(&manifest, &host, &mut errors);

        assert_eq!(errors[0]["code"], "MANIFEST_IMPORTS_INVALID");
        assert_eq!(errors[0]["target"], "allowedImports");
    }

    #[test]
    fn non_array_allowed_imports_is_rejected_as_invalid() {
        let manifest = json!({ "allowedImports": "env.log" });
        let host = json!({});
        let mut errors = vec![];

        validate_allowed_imports(&manifest, &host, &mut errors);

        assert_eq!(errors[0]["code"], "MANIFEST_IMPORTS_INVALID");
        assert_eq!(errors[0]["target"], "allowedImports");
    }

    #[test]
    fn any_import_passes_when_host_declares_no_allowlist() {
        let manifest = json!({ "allowedImports": ["env.anything", "custom.module"] });
        let host = json!({});
        let mut errors = vec![];

        validate_allowed_imports(&manifest, &host, &mut errors);

        assert!(errors.is_empty());
    }

    #[test]
    fn known_capabilities_granted_by_host_pass() {
        let manifest = json!({
            "permissions": {
                "network": { "enabled": true, "allow": ["https://api.example.com"] },
                "storage": "scoped",
                "effects": ["sendEmail"]
            }
        });
        let host = json!({ "allowedPermissions": ["network", "storage", "effects"] });
        let mut errors = vec![];

        validate_permissions(&manifest, &host, &mut errors);

        assert!(errors.is_empty());
    }

    #[test]
    fn unknown_capability_keys_get_one_error_per_key() {
        let manifest = json!({
            "permissions": {
                "clipboard": true,
                "usb": { "enabled": true },
                "dom": true
            }
        });
        let host = json!({ "allowedPermissions": ["dom"] });
        let mut errors = vec![];

        validate_permissions(&manifest, &host, &mut errors);

        assert_eq!(errors.len(), 2);
        let mut targets: Vec<&str> = errors
            .iter()
            .filter_map(|issue| issue.get("target").and_then(Value::as_str))
            .collect();
        targets.sort_unstable();
        assert_eq!(targets, vec!["permissions.clipboard", "permissions.usb"]);
        for error in &errors {
            assert_eq!(error["code"], "PERMISSION_UNKNOWN_CAPABILITY");
            assert!(error["message"]
                .as_str()
                .unwrap()
                .contains("network, storage, dom, crossStore, crossContainer, effects"));
        }
        assert!(errors.iter().any(|error| error["message"]
            .as_str()
            .unwrap()
            .contains("clipboard")));
    }

    #[test]
    fn requested_capability_missing_from_host_grant_list_is_error() {
        let manifest = json!({ "permissions": { "network": true, "dom": true } });
        let host = json!({ "allowedPermissions": ["dom"] });
        let mut errors = vec![];

        validate_permissions(&manifest, &host, &mut errors);

        assert_eq!(errors.len(), 1);
        assert_eq!(errors[0]["code"], "PERMISSION_NOT_GRANTED");
        assert_eq!(errors[0]["target"], "permissions.network");
        assert!(errors[0]["message"].as_str().unwrap().contains("network"));
    }

    #[test]
    fn inactive_permission_values_pass_without_host_grant() {
        let manifest = json!({
            "permissions": {
                "network": false,
                "storage": "none",
                "dom": { "enabled": false },
                "crossStore": { "mode": "none" },
                "effects": []
            }
        });
        let host = json!({ "allowedPermissions": [] });
        let mut errors = vec![];

        validate_permissions(&manifest, &host, &mut errors);

        assert!(errors.is_empty());
    }

    #[test]
    fn non_object_permissions_is_rejected_as_invalid() {
        for bad_permissions in [json!("network"), json!(["network"]), json!(true)] {
            let manifest = json!({ "permissions": bad_permissions });
            let host = json!({});
            let mut errors = vec![];

            validate_permissions(&manifest, &host, &mut errors);

            assert_eq!(errors[0]["code"], "MANIFEST_PERMISSIONS_INVALID");
            assert_eq!(errors[0]["target"], "permissions");
        }
    }

    #[test]
    fn requested_capability_passes_registry_check_when_host_has_no_grant_list() {
        let manifest = json!({ "permissions": { "network": true, "teleport": true } });
        let host = json!({});
        let mut errors = vec![];

        validate_permissions(&manifest, &host, &mut errors);

        assert_eq!(errors.len(), 1);
        assert_eq!(errors[0]["code"], "PERMISSION_UNKNOWN_CAPABILITY");
        assert_eq!(errors[0]["target"], "permissions.teleport");
    }

    #[test]
    fn version_ranges_are_checked() {
        assert!(version_satisfies("2.30.0", "^2.29.0"));
        assert!(!version_satisfies("3.0.0", "^2.29.0"));
        assert!(version_satisfies("12.4.0", ">=12.0.0"));
        assert!(!version_satisfies("11.8.0", ">=12.0.0"));
    }
}
