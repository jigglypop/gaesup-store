use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::cell::RefCell;
use std::collections::{HashMap, HashSet};
use wasm_bindgen::prelude::*;

use crate::{from_js, js_error, next_id, to_js};
use crate::render_math::compose_matrix;

thread_local! {
    static RENDER_STORES: RefCell<HashMap<String, RenderStore>> = RefCell::new(HashMap::new());
}

#[derive(Clone, Serialize, Deserialize)]
struct Transform {
    position: [f32; 3],
    rotation: [f32; 3],
    scale: [f32; 3],
}

impl Default for Transform {
    fn default() -> Self {
        Self {
            position: [0.0, 0.0, 0.0],
            rotation: [0.0, 0.0, 0.0],
            scale: [1.0, 1.0, 1.0],
        }
    }
}

impl Transform {
    fn matrix(&self) -> [f32; 16] {
        compose_matrix(self.position, self.rotation, self.scale)
    }
}

#[derive(Clone, Serialize, Deserialize)]
struct RenderEntity {
    id: String,
    instance_index: usize,
    transform: Transform,
    material_id: Option<String>,
    mesh_id: Option<String>,
    visible: bool,
}

#[derive(Clone, Serialize, Deserialize)]
struct ScreenTransition {
    id: String,
    from: String,
    to: String,
    duration_ms: f64,
    elapsed_ms: f64,
    easing: String,
    active: bool,
}

#[derive(Default)]
struct DirtyState {
    transforms: HashSet<String>,
    materials: HashSet<String>,
    screens: bool,
    frame: bool,
}

struct RenderStore {
    id: String,
    frame: u64,
    time_ms: f64,
    active_screen: String,
    next_screen: Option<String>,
    transition: Option<ScreenTransition>,
    entities: HashMap<String, RenderEntity>,
    entity_order: Vec<String>,
    next_instance_index: usize,
    dirty: DirtyState,
}

struct MatrixBufferPayload {
    instance_indices: Vec<u32>,
    matrices: Vec<f32>,
}

impl RenderStore {
    fn new(id: String, screen: String) -> Self {
        Self {
            id,
            frame: 0,
            time_ms: 0.0,
            active_screen: screen,
            next_screen: None,
            transition: None,
            entities: HashMap::new(),
            entity_order: Vec::new(),
            next_instance_index: 0,
            dirty: DirtyState::default(),
        }
    }

    fn tick(&mut self, delta_ms: f64) {
        self.frame += 1;
        self.time_ms += delta_ms;
        self.dirty.frame = true;

        if let Some(transition) = self.transition.as_mut() {
            if transition.active {
                transition.elapsed_ms = (transition.elapsed_ms + delta_ms).min(transition.duration_ms);
                self.dirty.screens = true;
                if transition.elapsed_ms >= transition.duration_ms {
                    self.active_screen = transition.to.clone();
                    self.next_screen = None;
                    transition.active = false;
                }
            }
        }
    }

    fn begin_transition(&mut self, to: String, duration_ms: f64, easing: String) {
        let transition = ScreenTransition {
            id: transition_id(),
            from: self.active_screen.clone(),
            to: to.clone(),
            duration_ms: duration_ms.max(0.0),
            elapsed_ms: 0.0,
            easing,
            active: true,
        };
        self.next_screen = Some(to);
        self.transition = Some(transition);
        self.dirty.screens = true;
    }

    fn insert_entity(&mut self, mut entity: RenderEntity) {
        if entity.instance_index == usize::MAX {
            entity.instance_index = self.next_instance_index;
            self.next_instance_index += 1;
        } else {
            self.next_instance_index = self.next_instance_index.max(entity.instance_index + 1);
        }
        if !self.entities.contains_key(&entity.id) {
            self.entity_order.push(entity.id.clone());
        }
        self.dirty.transforms.insert(entity.id.clone());
        if entity.material_id.is_some() {
            self.dirty.materials.insert(entity.id.clone());
        }
        self.entities.insert(entity.id.clone(), entity);
    }

    fn set_transform(&mut self, entity_id: &str, transform: Transform) -> Result<(), JsValue> {
        let entity = self
            .entities
            .get_mut(entity_id)
            .ok_or_else(|| js_error(&format!("Render entity not found: {entity_id}")))?;
        entity.transform = transform;
        self.dirty.transforms.insert(entity_id.to_string());
        Ok(())
    }

    fn rotate_y(&mut self, entity_id: &str, radians: f32) -> Result<(), JsValue> {
        let entity = self
            .entities
            .get_mut(entity_id)
            .ok_or_else(|| js_error(&format!("Render entity not found: {entity_id}")))?;
        entity.transform.rotation[1] += radians;
        self.dirty.transforms.insert(entity_id.to_string());
        Ok(())
    }

    fn patches(&mut self) -> Value {
        let transform_ids: Vec<String> = self.dirty.transforms.drain().collect();
        let material_ids: Vec<String> = self.dirty.materials.drain().collect();
        let transform_patches: Vec<Value> = transform_ids
            .iter()
            .filter_map(|id| self.entities.get(id))
            .map(|entity| serde_json::json!({
                "entityId": entity.id,
                "instanceIndex": entity.instance_index,
                "transform": entity.transform,
                "matrix": entity.transform.matrix(),
            }))
            .collect();

        let transition_progress = self.transition.as_ref().map(|transition| {
            if transition.duration_ms <= 0.0 {
                1.0
            } else {
                (transition.elapsed_ms / transition.duration_ms).clamp(0.0, 1.0)
            }
        });

        let patches = serde_json::json!({
            "storeId": self.id,
            "frame": self.frame,
            "timeMs": self.time_ms,
            "activeScreen": self.active_screen,
            "nextScreen": self.next_screen,
            "screenTransition": self.transition,
            "screenTransitionProgress": transition_progress,
            "dirty": {
                "frame": self.dirty.frame,
                "screens": self.dirty.screens,
                "transforms": transform_patches,
                "materials": material_ids,
            }
        });

        self.dirty.frame = false;
        self.dirty.screens = false;
        patches
    }

    fn matrix_buffer(&self) -> Value {
        let mut matrices = Vec::with_capacity(self.entities.len() * 16);
        let mut entities = Vec::with_capacity(self.entities.len());
        let mut ordered: Vec<&RenderEntity> = self.entities.values().collect();
        ordered.sort_by_key(|entity| entity.instance_index);

        for entity in ordered {
            matrices.extend(entity.transform.matrix());
            entities.push(serde_json::json!({
                "entityId": entity.id,
                "instanceIndex": entity.instance_index,
                "visible": entity.visible,
                "meshId": entity.mesh_id,
                "materialId": entity.material_id,
            }));
        }

        serde_json::json!({
            "storeId": self.id,
            "count": entities.len(),
            "strideFloats": 16,
            "strideBytes": 64,
            "entities": entities,
            "matrices": matrices,
        })
    }

    fn frame_state(&self) -> Value {
        let transition_progress = self.transition.as_ref().map(|transition| {
            if transition.duration_ms <= 0.0 {
                1.0
            } else {
                (transition.elapsed_ms / transition.duration_ms).clamp(0.0, 1.0)
            }
        });

        serde_json::json!({
            "storeId": self.id,
            "frame": self.frame,
            "timeMs": self.time_ms,
            "activeScreen": self.active_screen,
            "nextScreen": self.next_screen,
            "screenTransition": self.transition,
            "screenTransitionProgress": transition_progress,
            "dirty": {
                "frame": self.dirty.frame,
                "screens": self.dirty.screens,
                "transformCount": self.dirty.transforms.len(),
                "materialCount": self.dirty.materials.len(),
            }
        })
    }

    fn dirty_matrix_buffer(&mut self) -> MatrixBufferPayload {
        let transform_ids: Vec<String> = self.dirty.transforms.drain().collect();
        let mut dirty_entities: Vec<&RenderEntity> = transform_ids
            .iter()
            .filter_map(|id| self.entities.get(id))
            .collect();
        dirty_entities.sort_by_key(|entity| entity.instance_index);

        let mut instance_indices = Vec::with_capacity(dirty_entities.len());
        let mut matrices = Vec::with_capacity(dirty_entities.len() * 16);

        for entity in dirty_entities {
            instance_indices.push(entity.instance_index as u32);
            matrices.extend(entity.transform.matrix());
        }

        MatrixBufferPayload {
            instance_indices,
            matrices,
        }
    }
}

#[wasm_bindgen]
pub fn create_render_store(store_id: &str, initial_screen: &str) -> Result<(), JsValue> {
    RENDER_STORES.with(|stores| {
        let mut stores = stores.borrow_mut();
        if stores.contains_key(store_id) {
            return Err(js_error(&format!("Render store already exists: {store_id}")));
        }
        stores.insert(
            store_id.to_string(),
            RenderStore::new(store_id.to_string(), initial_screen.to_string()),
        );
        Ok(())
    })
}

#[wasm_bindgen]
pub fn create_render_entity(store_id: &str, entity: JsValue) -> Result<String, JsValue> {
    let value = from_js(entity)?;
    let entity_id = value
        .get("id")
        .and_then(Value::as_str)
        .map(ToString::to_string)
        .unwrap_or_else(|| next_id("entity"));
    let entity = RenderEntity {
        id: entity_id.clone(),
        instance_index: value
            .get("instanceIndex")
            .and_then(Value::as_u64)
            .map(|index| index as usize)
            .unwrap_or(usize::MAX),
        transform: parse_transform(value.get("transform")),
        material_id: value.get("materialId").and_then(Value::as_str).map(ToString::to_string),
        mesh_id: value.get("meshId").and_then(Value::as_str).map(ToString::to_string),
        visible: value.get("visible").and_then(Value::as_bool).unwrap_or(true),
    };

    RENDER_STORES.with(|stores| {
        let mut stores = stores.borrow_mut();
        let store = stores
            .get_mut(store_id)
            .ok_or_else(|| js_error(&format!("Render store not found: {store_id}")))?;
        store.insert_entity(entity);
        Ok(entity_id)
    })
}

#[wasm_bindgen]
pub fn set_render_transform(store_id: &str, entity_id: &str, transform: JsValue) -> Result<(), JsValue> {
    let transform_value = from_js(transform)?;
    let transform = parse_transform(Some(&transform_value));
    RENDER_STORES.with(|stores| {
        let mut stores = stores.borrow_mut();
        let store = stores
            .get_mut(store_id)
            .ok_or_else(|| js_error(&format!("Render store not found: {store_id}")))?;
        store.set_transform(entity_id, transform)
    })
}

#[wasm_bindgen]
pub fn rotate_render_entity_y(store_id: &str, entity_id: &str, radians: f32) -> Result<(), JsValue> {
    RENDER_STORES.with(|stores| {
        let mut stores = stores.borrow_mut();
        let store = stores
            .get_mut(store_id)
            .ok_or_else(|| js_error(&format!("Render store not found: {store_id}")))?;
        store.rotate_y(entity_id, radians)
    })
}

#[wasm_bindgen]
pub fn begin_screen_transition(
    store_id: &str,
    to_screen: &str,
    duration_ms: f64,
    easing: &str,
) -> Result<(), JsValue> {
    RENDER_STORES.with(|stores| {
        let mut stores = stores.borrow_mut();
        let store = stores
            .get_mut(store_id)
            .ok_or_else(|| js_error(&format!("Render store not found: {store_id}")))?;
        store.begin_transition(to_screen.to_string(), duration_ms, easing.to_string());
        Ok(())
    })
}

#[wasm_bindgen]
pub fn tick_render_frame(store_id: &str, delta_ms: f64) -> Result<JsValue, JsValue> {
    RENDER_STORES.with(|stores| {
        let mut stores = stores.borrow_mut();
        let store = stores
            .get_mut(store_id)
            .ok_or_else(|| js_error(&format!("Render store not found: {store_id}")))?;
        store.tick(delta_ms);
        to_js(&store.patches())
    })
}

#[wasm_bindgen]
pub fn tick_render_frame_state(store_id: &str, delta_ms: f64) -> Result<JsValue, JsValue> {
    RENDER_STORES.with(|stores| {
        let mut stores = stores.borrow_mut();
        let store = stores
            .get_mut(store_id)
            .ok_or_else(|| js_error(&format!("Render store not found: {store_id}")))?;
        store.tick(delta_ms);
        let frame = store.frame_state();
        store.dirty.frame = false;
        store.dirty.screens = false;
        to_js(&frame)
    })
}

#[wasm_bindgen]
pub fn get_render_patches(store_id: &str) -> Result<JsValue, JsValue> {
    RENDER_STORES.with(|stores| {
        let mut stores = stores.borrow_mut();
        let store = stores
            .get_mut(store_id)
            .ok_or_else(|| js_error(&format!("Render store not found: {store_id}")))?;
        to_js(&store.patches())
    })
}

#[wasm_bindgen]
pub fn get_render_matrix_buffer(store_id: &str) -> Result<JsValue, JsValue> {
    RENDER_STORES.with(|stores| {
        let stores = stores.borrow();
        let store = stores
            .get(store_id)
            .ok_or_else(|| js_error(&format!("Render store not found: {store_id}")))?;
        to_js(&store.matrix_buffer())
    })
}

#[wasm_bindgen]
pub fn get_render_dirty_matrix_buffer(store_id: &str) -> Result<JsValue, JsValue> {
    RENDER_STORES.with(|stores| {
        let mut stores = stores.borrow_mut();
        let store = stores
            .get_mut(store_id)
            .ok_or_else(|| js_error(&format!("Render store not found: {store_id}")))?;
        dirty_matrix_payload_to_js(store.dirty_matrix_buffer())
    })
}

#[wasm_bindgen]
pub fn cleanup_render_store(store_id: &str) {
    RENDER_STORES.with(|stores| {
        stores.borrow_mut().remove(store_id);
    });
}

#[wasm_bindgen]
pub fn benchmark_render_matrix_buffer(entity_count: u32) -> Result<JsValue, JsValue> {
    let count = entity_count.max(1);
    let mut store = RenderStore::new("render-bench".to_string(), "bench".to_string());
    let setup_start = js_sys::Date::now();

    for index in 0..count {
        let offset = index as f32;
        store.insert_entity(RenderEntity {
            id: format!("entity-{index}"),
            instance_index: index as usize,
            transform: Transform {
                position: [offset, offset * 0.5, offset * 0.25],
                rotation: [offset * 0.001, offset * 0.002, offset * 0.003],
                scale: [1.0, 1.0, 1.0],
            },
            material_id: None,
            mesh_id: None,
            visible: true,
        });
    }
    let setup_ms = js_sys::Date::now() - setup_start;

    let patch_start = js_sys::Date::now();
    let patches = store.patches();
    let patch_ms = js_sys::Date::now() - patch_start;

    let buffer_start = js_sys::Date::now();
    let buffer = store.matrix_buffer();
    let buffer_ms = js_sys::Date::now() - buffer_start;

    to_js(&serde_json::json!({
        "entityCount": count,
        "setupMs": setup_ms,
        "patchMs": patch_ms,
        "matrixBufferMs": buffer_ms,
        "patchCount": patches["dirty"]["transforms"].as_array().map(|items| items.len()).unwrap_or(0),
        "matrixFloatCount": buffer["matrices"].as_array().map(|items| items.len()).unwrap_or(0),
    }))
}

#[wasm_bindgen]
pub fn benchmark_render_dirty_matrix_buffer(entity_count: u32, dirty_count: u32) -> Result<JsValue, JsValue> {
    let count = entity_count.max(1);
    let dirty_count = dirty_count.min(count).max(1);
    let mut store = RenderStore::new("render-dirty-bench".to_string(), "bench".to_string());

    let setup_start = js_sys::Date::now();
    for index in 0..count {
        let offset = index as f32;
        store.insert_entity(RenderEntity {
            id: format!("entity-{index}"),
            instance_index: index as usize,
            transform: Transform {
                position: [offset, offset * 0.5, offset * 0.25],
                rotation: [offset * 0.001, offset * 0.002, offset * 0.003],
                scale: [1.0, 1.0, 1.0],
            },
            material_id: None,
            mesh_id: None,
            visible: true,
        });
    }
    store.dirty.transforms.clear();
    let setup_ms = js_sys::Date::now() - setup_start;

    for index in 0..dirty_count {
        let entity_id = format!("entity-{index}");
        store.rotate_y(&entity_id, 0.01)?;
    }

    let dirty_start = js_sys::Date::now();
    let payload = store.dirty_matrix_buffer();
    let dirty_ms = js_sys::Date::now() - dirty_start;

    to_js(&serde_json::json!({
        "entityCount": count,
        "dirtyCount": dirty_count,
        "setupMs": setup_ms,
        "dirtyMatrixBufferMs": dirty_ms,
        "matrixFloatCount": payload.matrices.len(),
        "indexCount": payload.instance_indices.len(),
    }))
}

fn parse_transform(value: Option<&Value>) -> Transform {
    let Some(value) = value else {
        return Transform::default();
    };
    Transform {
        position: parse_vec3(value.get("position")).unwrap_or([0.0, 0.0, 0.0]),
        rotation: parse_vec3(value.get("rotation")).unwrap_or([0.0, 0.0, 0.0]),
        scale: parse_vec3(value.get("scale")).unwrap_or([1.0, 1.0, 1.0]),
    }
}

fn parse_vec3(value: Option<&Value>) -> Option<[f32; 3]> {
    let array = value?.as_array()?;
    Some([
        array.first()?.as_f64()? as f32,
        array.get(1)?.as_f64()? as f32,
        array.get(2)?.as_f64()? as f32,
    ])
}

fn transition_id() -> String {
    #[cfg(target_arch = "wasm32")]
    {
        next_id("screen_transition")
    }
    #[cfg(not(target_arch = "wasm32"))]
    {
        "screen_transition_test".to_string()
    }
}

fn dirty_matrix_payload_to_js(payload: MatrixBufferPayload) -> Result<JsValue, JsValue> {
    let object = js_sys::Object::new();
    js_sys::Reflect::set(
        &object,
        &JsValue::from_str("count"),
        &JsValue::from_f64(payload.instance_indices.len() as f64),
    )?;
    js_sys::Reflect::set(
        &object,
        &JsValue::from_str("instanceIndices"),
        &js_sys::Uint32Array::from(payload.instance_indices.as_slice()).into(),
    )?;
    js_sys::Reflect::set(
        &object,
        &JsValue::from_str("matrices"),
        &js_sys::Float32Array::from(payload.matrices.as_slice()).into(),
    )?;
    Ok(object.into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frame_tick_advances_transition_and_finishes_screen() {
        let mut store = RenderStore::new("scene".to_string(), "home".to_string());
        store.begin_transition("editor".to_string(), 100.0, "linear".to_string());
        store.tick(40.0);
        let patches = store.patches();
        assert_eq!(patches["screenTransitionProgress"], 0.4);
        assert_eq!(patches["activeScreen"], "home");

        store.tick(60.0);
        let patches = store.patches();
        assert_eq!(patches["screenTransitionProgress"], 1.0);
        assert_eq!(patches["activeScreen"], "editor");
    }

    #[test]
    fn entity_transform_dirty_patch_is_drained_once() {
        let mut store = RenderStore::new("scene".to_string(), "home".to_string());
        store.insert_entity(RenderEntity {
            id: "cube".to_string(),
            instance_index: usize::MAX,
            transform: Transform::default(),
            material_id: None,
            mesh_id: None,
            visible: true,
        });
        store.rotate_y("cube", 0.5).unwrap();

        let patches = store.patches();
        assert_eq!(patches["dirty"]["transforms"].as_array().unwrap().len(), 1);
        assert_eq!(patches["dirty"]["transforms"][0]["entityId"], "cube");
        assert_eq!(patches["dirty"]["transforms"][0]["instanceIndex"], 0);
        assert!(patches["dirty"]["transforms"][0]["matrix"].as_array().is_some());

        let patches = store.patches();
        assert_eq!(patches["dirty"]["transforms"].as_array().unwrap().len(), 0);
    }

    #[test]
    fn transform_matrix_contains_translation() {
        let transform = Transform {
            position: [1.0, 2.0, 3.0],
            rotation: [0.0, 0.0, 0.0],
            scale: [1.0, 1.0, 1.0],
        };
        let matrix = transform.matrix();
        assert_eq!(matrix[12], 1.0);
        assert_eq!(matrix[13], 2.0);
        assert_eq!(matrix[14], 3.0);
        assert_eq!(matrix[15], 1.0);
    }

    #[test]
    fn matrix_buffer_is_sorted_by_instance_index() {
        let mut store = RenderStore::new("scene".to_string(), "home".to_string());
        store.insert_entity(RenderEntity {
            id: "b".to_string(),
            instance_index: 1,
            transform: Transform {
                position: [2.0, 0.0, 0.0],
                rotation: [0.0, 0.0, 0.0],
                scale: [1.0, 1.0, 1.0],
            },
            material_id: None,
            mesh_id: None,
            visible: true,
        });
        store.insert_entity(RenderEntity {
            id: "a".to_string(),
            instance_index: 0,
            transform: Transform {
                position: [1.0, 0.0, 0.0],
                rotation: [0.0, 0.0, 0.0],
                scale: [1.0, 1.0, 1.0],
            },
            material_id: None,
            mesh_id: None,
            visible: true,
        });

        let buffer = store.matrix_buffer();
        assert_eq!(buffer["count"], 2);
        assert_eq!(buffer["entities"][0]["entityId"], "a");
        assert_eq!(buffer["entities"][1]["entityId"], "b");
        assert_eq!(buffer["matrices"][12], 1.0);
        assert_eq!(buffer["matrices"][28], 2.0);
    }

    #[test]
    fn dirty_matrix_buffer_is_sorted_and_drained() {
        let mut store = RenderStore::new("scene".to_string(), "home".to_string());
        for index in 0..3 {
            store.insert_entity(RenderEntity {
                id: format!("entity-{index}"),
                instance_index: index,
                transform: Transform {
                    position: [index as f32, 0.0, 0.0],
                    rotation: [0.0, 0.0, 0.0],
                    scale: [1.0, 1.0, 1.0],
                },
                material_id: None,
                mesh_id: None,
                visible: true,
            });
        }
        store.dirty.transforms.clear();
        store.rotate_y("entity-2", 0.2).unwrap();
        store.rotate_y("entity-0", 0.2).unwrap();

        let payload = store.dirty_matrix_buffer();

        assert_eq!(payload.instance_indices, vec![0, 2]);
        assert_eq!(payload.matrices.len(), 32);
        assert!(store.dirty_matrix_buffer().instance_indices.is_empty());
    }

    #[test]
    fn frame_state_does_not_drain_transform_dirty_set() {
        let mut store = RenderStore::new("scene".to_string(), "home".to_string());
        store.insert_entity(RenderEntity {
            id: "cube".to_string(),
            instance_index: usize::MAX,
            transform: Transform::default(),
            material_id: None,
            mesh_id: None,
            visible: true,
        });
        store.tick(16.0);
        let frame = store.frame_state();
        assert_eq!(frame["dirty"]["transformCount"], 1);
        assert_eq!(store.dirty.transforms.len(), 1);
    }

    #[test]
    fn matrix_buffer_native_benchmark_budget() {
        let mut store = RenderStore::new("scene".to_string(), "home".to_string());
        for index in 0..10_000 {
            let offset = index as f32;
            store.insert_entity(RenderEntity {
                id: format!("entity-{index}"),
                instance_index: index,
                transform: Transform {
                    position: [offset, offset * 0.5, offset * 0.25],
                    rotation: [offset * 0.001, offset * 0.002, offset * 0.003],
                    scale: [1.0, 1.0, 1.0],
                },
                material_id: None,
                mesh_id: None,
                visible: true,
            });
        }

        let start = std::time::Instant::now();
        let buffer = store.matrix_buffer();
        let elapsed = start.elapsed();

        assert_eq!(buffer["count"], 10_000);
        assert_eq!(buffer["matrices"].as_array().unwrap().len(), 160_000);
        assert!(
            elapsed.as_millis() < 150,
            "10k matrix buffer export should stay under 150ms in native tests, got {:?}",
            elapsed
        );
    }

    #[test]
    fn dirty_matrix_buffer_native_benchmark_budget() {
        let mut store = RenderStore::new("scene".to_string(), "home".to_string());
        for index in 0..10_000 {
            let offset = index as f32;
            store.insert_entity(RenderEntity {
                id: format!("entity-{index}"),
                instance_index: index,
                transform: Transform {
                    position: [offset, offset * 0.5, offset * 0.25],
                    rotation: [offset * 0.001, offset * 0.002, offset * 0.003],
                    scale: [1.0, 1.0, 1.0],
                },
                material_id: None,
                mesh_id: None,
                visible: true,
            });
        }
        store.dirty.transforms.clear();
        for index in 0..1_000 {
            store.rotate_y(&format!("entity-{index}"), 0.01).unwrap();
        }

        let start = std::time::Instant::now();
        let payload = store.dirty_matrix_buffer();
        let elapsed = start.elapsed();

        assert_eq!(payload.instance_indices.len(), 1_000);
        assert_eq!(payload.matrices.len(), 16_000);
        assert!(
            elapsed.as_millis() < 30,
            "1k dirty matrix buffer export should stay under 30ms in native tests, got {:?}",
            elapsed
        );
    }
}
