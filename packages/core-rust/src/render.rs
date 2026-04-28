use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::cell::RefCell;
use std::collections::{HashMap, HashSet};
use wasm_bindgen::prelude::*;

use crate::{from_js, js_error, next_id, to_js};
use crate::render_math::{compose_matrix, multiply_matrix};

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
#[serde(rename_all = "camelCase")]
struct RenderEntity {
    id: String,
    parent_id: Option<String>,
    instance_index: usize,
    transform: Transform,
    size: [f32; 2],
    material_id: Option<String>,
    mesh_id: Option<String>,
    visible: bool,
    locked: bool,
}

impl RenderEntity {
    fn contains_point(&self, x: f32, y: f32, world_matrix: [f32; 16]) -> bool {
        if !self.visible || self.locked {
            return false;
        }
        let half_width = (self.size[0] * self.transform.scale[0]).abs() * 0.5;
        let half_height = (self.size[1] * self.transform.scale[1]).abs() * 0.5;
        let center_x = world_matrix[12];
        let center_y = world_matrix[13];

        x >= center_x - half_width &&
            x <= center_x + half_width &&
            y >= center_y - half_height &&
            y <= center_y + half_height
    }

    fn intersects_rect(&self, min_x: f32, min_y: f32, max_x: f32, max_y: f32, world_matrix: [f32; 16]) -> bool {
        if !self.visible || self.locked {
            return false;
        }
        let half_width = (self.size[0] * self.transform.scale[0]).abs() * 0.5;
        let half_height = (self.size[1] * self.transform.scale[1]).abs() * 0.5;
        let left = world_matrix[12] - half_width;
        let right = world_matrix[12] + half_width;
        let top = world_matrix[13] - half_height;
        let bottom = world_matrix[13] + half_height;

        right >= min_x && left <= max_x && bottom >= min_y && top <= max_y
    }
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct EntityHit {
    entity_id: String,
    instance_index: usize,
    x: f32,
    y: f32,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TimelineCommand {
    id: String,
    time_ms: f64,
    command_type: String,
    entity_id: Option<String>,
    before: Value,
    after: Value,
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
    selection: Vec<String>,
    command_log: Vec<TimelineCommand>,
    redo_log: Vec<TimelineCommand>,
    next_instance_index: usize,
    dirty: DirtyState,
}

struct MatrixBufferPayload {
    instance_indices: Vec<u32>,
    matrices: Vec<f32>,
}

#[derive(Debug, PartialEq)]
struct MatrixBufferRange {
    start_instance_index: u32,
    count: u32,
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
            selection: Vec::new(),
            command_log: Vec::new(),
            redo_log: Vec::new(),
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

    fn remove_entity(&mut self, entity_id: &str) -> Option<RenderEntity> {
        let removed = self.entities.remove(entity_id)?;
        self.entity_order.retain(|id| id != entity_id);
        self.selection.retain(|id| id != entity_id);
        self.dirty.transforms.insert(entity_id.to_string());
        Some(removed)
    }

    fn set_transform(&mut self, entity_id: &str, transform: Transform) -> Result<(), JsValue> {
        let entity = self
            .entities
            .get_mut(entity_id)
            .ok_or_else(|| js_error(&format!("Render entity not found: {entity_id}")))?;
        entity.transform = transform;
        self.mark_transform_dirty_recursive(entity_id);
        Ok(())
    }

    fn set_parent(&mut self, entity_id: &str, parent_id: Option<String>) -> Result<(), JsValue> {
        if let Some(parent_id) = parent_id.as_deref() {
            if parent_id == entity_id {
                return Err(js_error("Render entity cannot parent itself"));
            }
            if !self.entities.contains_key(parent_id) {
                return Err(js_error(&format!("Parent render entity not found: {parent_id}")));
            }
            if self.is_descendant(parent_id, entity_id) {
                return Err(js_error("Render entity parent cycle detected"));
            }
        }

        let entity = self
            .entities
            .get_mut(entity_id)
            .ok_or_else(|| js_error(&format!("Render entity not found: {entity_id}")))?;
        entity.parent_id = parent_id;
        self.mark_transform_dirty_recursive(entity_id);
        Ok(())
    }

    fn hit_test(&self, x: f32, y: f32) -> Option<EntityHit> {
        self.entity_order
            .iter()
            .rev()
            .filter_map(|id| self.entities.get(id))
            .find(|entity| entity.contains_point(x, y, self.world_matrix_for_entity(&entity.id)))
            .map(|entity| EntityHit {
                entity_id: entity.id.clone(),
                instance_index: entity.instance_index,
                x,
                y,
            })
    }

    fn select_entities(&mut self, ids: Vec<String>, append: bool) -> Vec<String> {
        if !append {
            self.selection.clear();
        }
        for id in ids {
            if self.entities.contains_key(&id) && !self.selection.contains(&id) {
                self.selection.push(id);
            }
        }
        self.selection.clone()
    }

    fn select_at(&mut self, x: f32, y: f32, append: bool) -> Vec<String> {
        let before = selection_value(&self.selection);
        let hit = self.hit_test(x, y);
        let next = hit
            .map(|hit| self.select_entities(vec![hit.entity_id], append))
            .unwrap_or_else(|| {
                if !append {
                    self.selection.clear();
                }
                self.selection.clone()
            });
        self.record_command("select", None, before, selection_value(&next));
        next
    }

    fn select_rect(&mut self, min_x: f32, min_y: f32, max_x: f32, max_y: f32, append: bool) -> Vec<String> {
        let before = selection_value(&self.selection);
        let ids = self.entity_order
            .iter()
            .filter_map(|id| self.entities.get(id))
            .filter(|entity| entity.intersects_rect(
                min_x,
                min_y,
                max_x,
                max_y,
                self.world_matrix_for_entity(&entity.id),
            ))
            .map(|entity| entity.id.clone())
            .collect();
        let next = self.select_entities(ids, append);
        self.record_command("select", None, before, selection_value(&next));
        next
    }

    fn apply_command(&mut self, command: Value) -> Result<TimelineCommand, JsValue> {
        let command_type = command
            .get("type")
            .or_else(|| command.get("commandType"))
            .and_then(Value::as_str)
            .ok_or_else(|| js_error("Render command requires type"))?;

        match command_type {
            "updateTransform" => {
                let entity_id = command
                    .get("entityId")
                    .and_then(Value::as_str)
                    .ok_or_else(|| js_error("updateTransform requires entityId"))?;
                let before = entity_transform_value(
                    self.entities
                        .get(entity_id)
                        .ok_or_else(|| js_error(&format!("Render entity not found: {entity_id}")))?,
                );
                let transform = parse_transform(command.get("transform"));
                self.set_transform(entity_id, transform)?;
                let after = entity_transform_value(
                    self.entities
                        .get(entity_id)
                        .ok_or_else(|| js_error(&format!("Render entity not found: {entity_id}")))?,
                );
                Ok(self.record_command("updateTransform", Some(entity_id.to_string()), before, after))
            }
            "select" => {
                let before = selection_value(&self.selection);
                let ids = command
                    .get("entityIds")
                    .and_then(Value::as_array)
                    .map(|items| items.iter().filter_map(Value::as_str).map(ToString::to_string).collect())
                    .unwrap_or_default();
                let append = command.get("append").and_then(Value::as_bool).unwrap_or(false);
                let next = self.select_entities(ids, append);
                Ok(self.record_command("select", None, before, selection_value(&next)))
            }
            "setParent" => {
                let entity_id = command
                    .get("entityId")
                    .and_then(Value::as_str)
                    .ok_or_else(|| js_error("setParent requires entityId"))?;
                let before = entity_parent_value(
                    self.entities
                        .get(entity_id)
                        .ok_or_else(|| js_error(&format!("Render entity not found: {entity_id}")))?,
                );
                let parent_id = command.get("parentId").and_then(Value::as_str).map(ToString::to_string);
                self.set_parent(entity_id, parent_id)?;
                let after = entity_parent_value(
                    self.entities
                        .get(entity_id)
                        .ok_or_else(|| js_error(&format!("Render entity not found: {entity_id}")))?,
                );
                Ok(self.record_command("setParent", Some(entity_id.to_string()), before, after))
            }
            "delete" => {
                let entity_id = command
                    .get("entityId")
                    .and_then(Value::as_str)
                    .ok_or_else(|| js_error("delete requires entityId"))?;
                let entity = self
                    .remove_entity(entity_id)
                    .ok_or_else(|| js_error(&format!("Render entity not found: {entity_id}")))?;
                Ok(self.record_command("delete", Some(entity_id.to_string()), entity_value(&entity), Value::Null))
            }
            other => Err(js_error(&format!("Unsupported render command: {other}"))),
        }
    }

    fn undo(&mut self) -> Result<Option<TimelineCommand>, JsValue> {
        let Some(command) = self.command_log.pop() else {
            return Ok(None);
        };
        self.apply_command_snapshot(&command, true)?;
        self.redo_log.push(command.clone());
        Ok(Some(command))
    }

    fn redo(&mut self) -> Result<Option<TimelineCommand>, JsValue> {
        let Some(command) = self.redo_log.pop() else {
            return Ok(None);
        };
        self.apply_command_snapshot(&command, false)?;
        self.command_log.push(command.clone());
        Ok(Some(command))
    }

    fn apply_command_snapshot(&mut self, command: &TimelineCommand, undo: bool) -> Result<(), JsValue> {
        match command.command_type.as_str() {
            "updateTransform" => {
                let entity_id = command.entity_id.as_deref().ok_or_else(|| js_error("Command missing entity id"))?;
                let value = if undo { &command.before } else { &command.after };
                self.set_transform(entity_id, parse_transform(Some(value)))?;
            }
            "select" => {
                let value = if undo { &command.before } else { &command.after };
                self.selection = value
                    .as_array()
                    .map(|items| items.iter().filter_map(Value::as_str).map(ToString::to_string).collect())
                    .unwrap_or_default();
            }
            "setParent" => {
                let entity_id = command.entity_id.as_deref().ok_or_else(|| js_error("Command missing entity id"))?;
                let value = if undo { &command.before } else { &command.after };
                let parent_id = value.get("parentId").and_then(Value::as_str).map(ToString::to_string);
                self.set_parent(entity_id, parent_id)?;
            }
            "delete" => {
                if undo {
                    let entity = parse_entity(&command.before)?;
                    self.insert_entity(entity);
                } else if let Some(entity_id) = command.entity_id.as_deref() {
                    self.remove_entity(entity_id);
                }
            }
            _ => {}
        }
        Ok(())
    }

    fn record_command(
        &mut self,
        command_type: &str,
        entity_id: Option<String>,
        before: Value,
        after: Value,
    ) -> TimelineCommand {
        let command = TimelineCommand {
            id: command_id(),
            time_ms: self.time_ms,
            command_type: command_type.to_string(),
            entity_id,
            before,
            after,
        };
        self.command_log.push(command.clone());
        self.redo_log.clear();
        command
    }

    fn rotate_y(&mut self, entity_id: &str, radians: f32) -> Result<(), JsValue> {
        let entity = self
            .entities
            .get_mut(entity_id)
            .ok_or_else(|| js_error(&format!("Render entity not found: {entity_id}")))?;
        entity.transform.rotation[1] += radians;
        self.mark_transform_dirty_recursive(entity_id);
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
                "matrix": self.world_matrix_for_entity(&entity.id),
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
            matrices.extend(self.world_matrix_for_entity(&entity.id));
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
            },
            "selection": self.selection,
            "timeline": {
                "commandCount": self.command_log.len(),
                "redoCount": self.redo_log.len(),
            },
        })
    }

    fn dirty_matrix_buffer(&mut self) -> MatrixBufferPayload {
        let transform_ids: Vec<String> = self.dirty.transforms.drain().collect();
        self.dirty_matrix_buffer_for_ids(transform_ids)
    }

    fn dirty_matrix_ranges(&mut self) -> Vec<MatrixBufferRange> {
        let payload = self.dirty_matrix_buffer();
        matrix_payload_to_ranges(payload)
    }

    fn dirty_matrix_buffer_for_ids(&self, transform_ids: Vec<String>) -> MatrixBufferPayload {
        let mut dirty_entities: Vec<&RenderEntity> = transform_ids
            .iter()
            .filter_map(|id| self.entities.get(id))
            .collect();
        dirty_entities.sort_by_key(|entity| entity.instance_index);

        let mut instance_indices = Vec::with_capacity(dirty_entities.len());
        let mut matrices = Vec::with_capacity(dirty_entities.len() * 16);

        for entity in dirty_entities {
            instance_indices.push(entity.instance_index as u32);
            matrices.extend(self.world_matrix_for_entity(&entity.id));
        }

        MatrixBufferPayload {
            instance_indices,
            matrices,
        }
    }

    fn mark_transform_dirty_recursive(&mut self, entity_id: &str) {
        self.dirty.transforms.insert(entity_id.to_string());
        let children: Vec<String> = self
            .entities
            .values()
            .filter(|entity| entity.parent_id.as_deref() == Some(entity_id))
            .map(|entity| entity.id.clone())
            .collect();

        for child_id in children {
            self.mark_transform_dirty_recursive(&child_id);
        }
    }

    fn is_descendant(&self, entity_id: &str, ancestor_id: &str) -> bool {
        let mut current_id = Some(entity_id);
        while let Some(id) = current_id {
            if id == ancestor_id {
                return true;
            }
            current_id = self
                .entities
                .get(id)
                .and_then(|entity| entity.parent_id.as_deref());
        }
        false
    }

    fn world_matrix_for_entity(&self, entity_id: &str) -> [f32; 16] {
        let mut visited = HashSet::new();
        self.world_matrix_for_entity_inner(entity_id, &mut visited)
    }

    fn world_matrix_for_entity_inner(&self, entity_id: &str, visited: &mut HashSet<String>) -> [f32; 16] {
        let Some(entity) = self.entities.get(entity_id) else {
            return Transform::default().matrix();
        };

        let local_matrix = entity.transform.matrix();
        let Some(parent_id) = entity.parent_id.as_deref() else {
            return local_matrix;
        };

        if !visited.insert(entity_id.to_string()) {
            return local_matrix;
        }

        let parent_matrix = self.world_matrix_for_entity_inner(parent_id, visited);
        multiply_matrix(parent_matrix, local_matrix)
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
        parent_id: value.get("parentId").and_then(Value::as_str).map(ToString::to_string),
        instance_index: value
            .get("instanceIndex")
            .and_then(Value::as_u64)
            .map(|index| index as usize)
            .unwrap_or(usize::MAX),
        transform: parse_transform(value.get("transform")),
        size: parse_vec2(value.get("size")).unwrap_or([100.0, 100.0]),
        material_id: value.get("materialId").and_then(Value::as_str).map(ToString::to_string),
        mesh_id: value.get("meshId").and_then(Value::as_str).map(ToString::to_string),
        visible: value.get("visible").and_then(Value::as_bool).unwrap_or(true),
        locked: value.get("locked").and_then(Value::as_bool).unwrap_or(false),
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
pub fn hit_test_render_entity(store_id: &str, x: f32, y: f32) -> Result<JsValue, JsValue> {
    RENDER_STORES.with(|stores| {
        let stores = stores.borrow();
        let store = stores
            .get(store_id)
            .ok_or_else(|| js_error(&format!("Render store not found: {store_id}")))?;
        to_js(&store.hit_test(x, y))
    })
}

#[wasm_bindgen]
pub fn select_render_entity_at(store_id: &str, x: f32, y: f32, append: bool) -> Result<JsValue, JsValue> {
    RENDER_STORES.with(|stores| {
        let mut stores = stores.borrow_mut();
        let store = stores
            .get_mut(store_id)
            .ok_or_else(|| js_error(&format!("Render store not found: {store_id}")))?;
        to_js(&store.select_at(x, y, append))
    })
}

#[wasm_bindgen]
pub fn select_render_entities_in_rect(
    store_id: &str,
    min_x: f32,
    min_y: f32,
    max_x: f32,
    max_y: f32,
    append: bool,
) -> Result<JsValue, JsValue> {
    RENDER_STORES.with(|stores| {
        let mut stores = stores.borrow_mut();
        let store = stores
            .get_mut(store_id)
            .ok_or_else(|| js_error(&format!("Render store not found: {store_id}")))?;
        to_js(&store.select_rect(min_x, min_y, max_x, max_y, append))
    })
}

#[wasm_bindgen]
pub fn get_render_selection(store_id: &str) -> Result<JsValue, JsValue> {
    RENDER_STORES.with(|stores| {
        let stores = stores.borrow();
        let store = stores
            .get(store_id)
            .ok_or_else(|| js_error(&format!("Render store not found: {store_id}")))?;
        to_js(&store.selection)
    })
}

#[wasm_bindgen]
pub fn apply_render_command(store_id: &str, command: JsValue) -> Result<JsValue, JsValue> {
    let command = from_js(command)?;
    RENDER_STORES.with(|stores| {
        let mut stores = stores.borrow_mut();
        let store = stores
            .get_mut(store_id)
            .ok_or_else(|| js_error(&format!("Render store not found: {store_id}")))?;
        to_js(&store.apply_command(command)?)
    })
}

#[wasm_bindgen]
pub fn undo_render_command(store_id: &str) -> Result<JsValue, JsValue> {
    RENDER_STORES.with(|stores| {
        let mut stores = stores.borrow_mut();
        let store = stores
            .get_mut(store_id)
            .ok_or_else(|| js_error(&format!("Render store not found: {store_id}")))?;
        to_js(&store.undo()?)
    })
}

#[wasm_bindgen]
pub fn redo_render_command(store_id: &str) -> Result<JsValue, JsValue> {
    RENDER_STORES.with(|stores| {
        let mut stores = stores.borrow_mut();
        let store = stores
            .get_mut(store_id)
            .ok_or_else(|| js_error(&format!("Render store not found: {store_id}")))?;
        to_js(&store.redo()?)
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
pub fn set_render_parent(store_id: &str, entity_id: &str, parent_id: JsValue) -> Result<(), JsValue> {
    let parent_id = if parent_id.is_null() || parent_id.is_undefined() {
        None
    } else {
        parent_id.as_string()
    };

    RENDER_STORES.with(|stores| {
        let mut stores = stores.borrow_mut();
        let store = stores
            .get_mut(store_id)
            .ok_or_else(|| js_error(&format!("Render store not found: {store_id}")))?;
        store.set_parent(entity_id, parent_id)
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
pub fn get_render_dirty_matrix_ranges(store_id: &str) -> Result<JsValue, JsValue> {
    RENDER_STORES.with(|stores| {
        let mut stores = stores.borrow_mut();
        let store = stores
            .get_mut(store_id)
            .ok_or_else(|| js_error(&format!("Render store not found: {store_id}")))?;
        dirty_matrix_ranges_to_js(store.dirty_matrix_ranges())
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
            parent_id: None,
            instance_index: index as usize,
            transform: Transform {
                position: [offset, offset * 0.5, offset * 0.25],
                rotation: [offset * 0.001, offset * 0.002, offset * 0.003],
                scale: [1.0, 1.0, 1.0],
            },
            size: [100.0, 100.0],
            material_id: None,
            mesh_id: None,
            visible: true,
            locked: false,
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
            parent_id: None,
            instance_index: index as usize,
            transform: Transform {
                position: [offset, offset * 0.5, offset * 0.25],
                rotation: [offset * 0.001, offset * 0.002, offset * 0.003],
                scale: [1.0, 1.0, 1.0],
            },
            size: [100.0, 100.0],
            material_id: None,
            mesh_id: None,
            visible: true,
            locked: false,
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

#[wasm_bindgen]
pub fn benchmark_render_dirty_matrix_ranges(entity_count: u32, dirty_count: u32, stride: u32) -> Result<JsValue, JsValue> {
    let count = entity_count.max(1);
    let dirty_count = dirty_count.min(count).max(1);
    let stride = stride.max(1);
    let mut store = RenderStore::new("render-range-bench".to_string(), "bench".to_string());

    let setup_start = js_sys::Date::now();
    for index in 0..count {
        let offset = index as f32;
        store.insert_entity(RenderEntity {
            id: format!("entity-{index}"),
            parent_id: None,
            instance_index: index as usize,
            transform: Transform {
                position: [offset, offset * 0.5, offset * 0.25],
                rotation: [offset * 0.001, offset * 0.002, offset * 0.003],
                scale: [1.0, 1.0, 1.0],
            },
            size: [100.0, 100.0],
            material_id: None,
            mesh_id: None,
            visible: true,
            locked: false,
        });
    }
    store.dirty.transforms.clear();
    let setup_ms = js_sys::Date::now() - setup_start;

    for index in 0..dirty_count {
        let entity_index = index.saturating_mul(stride) % count;
        store.rotate_y(&format!("entity-{entity_index}"), 0.01)?;
    }

    let range_start = js_sys::Date::now();
    let ranges = store.dirty_matrix_ranges();
    let range_ms = js_sys::Date::now() - range_start;
    let matrix_float_count: usize = ranges.iter().map(|range| range.matrices.len()).sum();

    to_js(&serde_json::json!({
        "entityCount": count,
        "dirtyCount": dirty_count,
        "stride": stride,
        "setupMs": setup_ms,
        "dirtyMatrixRangeMs": range_ms,
        "rangeCount": ranges.len(),
        "matrixFloatCount": matrix_float_count,
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

fn parse_vec2(value: Option<&Value>) -> Option<[f32; 2]> {
    let array = value?.as_array()?;
    Some([
        array.first()?.as_f64()? as f32,
        array.get(1)?.as_f64()? as f32,
    ])
}

fn parse_entity(value: &Value) -> Result<RenderEntity, JsValue> {
    let id = value
        .get("id")
        .and_then(Value::as_str)
        .ok_or_else(|| js_error("Entity snapshot requires id"))?
        .to_string();
    Ok(RenderEntity {
        id,
        parent_id: value.get("parentId").and_then(Value::as_str).map(ToString::to_string),
        instance_index: value
            .get("instanceIndex")
            .and_then(Value::as_u64)
            .map(|index| index as usize)
            .unwrap_or(usize::MAX),
        transform: parse_transform(value.get("transform")),
        size: parse_vec2(value.get("size")).unwrap_or([100.0, 100.0]),
        material_id: value.get("materialId").and_then(Value::as_str).map(ToString::to_string),
        mesh_id: value.get("meshId").and_then(Value::as_str).map(ToString::to_string),
        visible: value.get("visible").and_then(Value::as_bool).unwrap_or(true),
        locked: value.get("locked").and_then(Value::as_bool).unwrap_or(false),
    })
}

fn entity_transform_value(entity: &RenderEntity) -> Value {
    serde_json::json!({
        "position": entity.transform.position,
        "rotation": entity.transform.rotation,
        "scale": entity.transform.scale,
    })
}

fn entity_parent_value(entity: &RenderEntity) -> Value {
    serde_json::json!({
        "parentId": entity.parent_id,
    })
}

fn entity_value(entity: &RenderEntity) -> Value {
    serde_json::json!({
        "id": entity.id,
        "parentId": entity.parent_id,
        "instanceIndex": entity.instance_index,
        "transform": entity.transform,
        "size": entity.size,
        "materialId": entity.material_id,
        "meshId": entity.mesh_id,
        "visible": entity.visible,
        "locked": entity.locked,
    })
}

fn selection_value(selection: &[String]) -> Value {
    Value::Array(selection.iter().map(|id| Value::String(id.clone())).collect())
}

fn command_id() -> String {
    #[cfg(target_arch = "wasm32")]
    {
        next_id("cmd")
    }
    #[cfg(not(target_arch = "wasm32"))]
    {
        "cmd_test".to_string()
    }
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

fn dirty_matrix_ranges_to_js(ranges: Vec<MatrixBufferRange>) -> Result<JsValue, JsValue> {
    let array = js_sys::Array::new();
    for range in ranges {
        let object = js_sys::Object::new();
        js_sys::Reflect::set(
            &object,
            &JsValue::from_str("startInstanceIndex"),
            &JsValue::from_f64(range.start_instance_index as f64),
        )?;
        js_sys::Reflect::set(
            &object,
            &JsValue::from_str("count"),
            &JsValue::from_f64(range.count as f64),
        )?;
        js_sys::Reflect::set(
            &object,
            &JsValue::from_str("matrices"),
            &js_sys::Float32Array::from(range.matrices.as_slice()).into(),
        )?;
        array.push(&object);
    }
    Ok(array.into())
}

fn matrix_payload_to_ranges(payload: MatrixBufferPayload) -> Vec<MatrixBufferRange> {
    let mut ranges: Vec<MatrixBufferRange> = Vec::new();

    for (matrix_index, instance_index) in payload.instance_indices.iter().copied().enumerate() {
        let matrix_start = matrix_index * 16;
        let matrix_end = matrix_start + 16;
        let matrix = &payload.matrices[matrix_start..matrix_end];

        if let Some(last) = ranges.last_mut() {
            if last.start_instance_index + last.count == instance_index {
                last.count += 1;
                last.matrices.extend_from_slice(matrix);
                continue;
            }
        }

        ranges.push(MatrixBufferRange {
            start_instance_index: instance_index,
            count: 1,
            matrices: matrix.to_vec(),
        });
    }

    ranges
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
            parent_id: None,
            instance_index: usize::MAX,
            transform: Transform::default(),
            size: [100.0, 100.0],
            material_id: None,
            mesh_id: None,
            visible: true,
            locked: false,
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
            parent_id: None,
            instance_index: 1,
            transform: Transform {
                position: [2.0, 0.0, 0.0],
                rotation: [0.0, 0.0, 0.0],
                scale: [1.0, 1.0, 1.0],
            },
            size: [100.0, 100.0],
            material_id: None,
            mesh_id: None,
            visible: true,
            locked: false,
        });
        store.insert_entity(RenderEntity {
            id: "a".to_string(),
            parent_id: None,
            instance_index: 0,
            transform: Transform {
                position: [1.0, 0.0, 0.0],
                rotation: [0.0, 0.0, 0.0],
                scale: [1.0, 1.0, 1.0],
            },
            size: [100.0, 100.0],
            material_id: None,
            mesh_id: None,
            visible: true,
            locked: false,
        });

        let buffer = store.matrix_buffer();
        assert_eq!(buffer["count"], 2);
        assert_eq!(buffer["entities"][0]["entityId"], "a");
        assert_eq!(buffer["entities"][1]["entityId"], "b");
        assert_eq!(buffer["matrices"][12], 1.0);
        assert_eq!(buffer["matrices"][28], 2.0);
    }

    #[test]
    fn hit_test_selects_topmost_visible_entity() {
        let mut store = RenderStore::new("scene".to_string(), "home".to_string());
        store.insert_entity(RenderEntity {
            id: "back".to_string(),
            parent_id: None,
            instance_index: 0,
            transform: Transform::default(),
            size: [100.0, 100.0],
            material_id: None,
            mesh_id: None,
            visible: true,
            locked: false,
        });
        store.insert_entity(RenderEntity {
            id: "front".to_string(),
            parent_id: None,
            instance_index: 1,
            transform: Transform::default(),
            size: [100.0, 100.0],
            material_id: None,
            mesh_id: None,
            visible: true,
            locked: false,
        });

        let hit = store.hit_test(0.0, 0.0).unwrap();
        assert_eq!(hit.entity_id, "front");
        assert_eq!(store.select_at(0.0, 0.0, false), vec!["front".to_string()]);
        assert_eq!(store.command_log.len(), 1);
    }

    #[test]
    fn command_timeline_updates_transform_and_supports_undo_redo() {
        let mut store = RenderStore::new("scene".to_string(), "home".to_string());
        store.insert_entity(RenderEntity {
            id: "cube".to_string(),
            parent_id: None,
            instance_index: 0,
            transform: Transform::default(),
            size: [100.0, 100.0],
            material_id: None,
            mesh_id: None,
            visible: true,
            locked: false,
        });

        store
            .apply_command(serde_json::json!({
                "type": "updateTransform",
                "entityId": "cube",
                "transform": {
                    "position": [10.0, 20.0, 0.0],
                    "rotation": [0.0, 0.0, 0.0],
                    "scale": [1.0, 1.0, 1.0]
                }
            }))
            .unwrap();

        assert_eq!(store.entities["cube"].transform.position, [10.0, 20.0, 0.0]);
        store.undo().unwrap();
        assert_eq!(store.entities["cube"].transform.position, [0.0, 0.0, 0.0]);
        store.redo().unwrap();
        assert_eq!(store.entities["cube"].transform.position, [10.0, 20.0, 0.0]);
    }

    #[test]
    fn parent_transform_updates_child_world_matrix_and_dirty_state() {
        let mut store = RenderStore::new("scene".to_string(), "home".to_string());
        store.insert_entity(RenderEntity {
            id: "parent".to_string(),
            parent_id: None,
            instance_index: 0,
            transform: Transform {
                position: [10.0, 0.0, 0.0],
                rotation: [0.0, 0.0, 0.0],
                scale: [1.0, 1.0, 1.0],
            },
            size: [100.0, 100.0],
            material_id: None,
            mesh_id: None,
            visible: true,
            locked: false,
        });
        store.insert_entity(RenderEntity {
            id: "child".to_string(),
            parent_id: Some("parent".to_string()),
            instance_index: 1,
            transform: Transform {
                position: [3.0, 0.0, 0.0],
                rotation: [0.0, 0.0, 0.0],
                scale: [1.0, 1.0, 1.0],
            },
            size: [10.0, 10.0],
            material_id: None,
            mesh_id: None,
            visible: true,
            locked: false,
        });
        store.dirty.transforms.clear();

        store.set_transform("parent", Transform {
            position: [20.0, 0.0, 0.0],
            rotation: [0.0, 0.0, 0.0],
            scale: [1.0, 1.0, 1.0],
        }).unwrap();
        let payload = store.dirty_matrix_buffer();

        assert_eq!(payload.instance_indices, vec![0, 1]);
        assert_eq!(payload.matrices[12], 20.0);
        assert_eq!(payload.matrices[28], 23.0);
        assert_eq!(store.hit_test(23.0, 0.0).unwrap().entity_id, "child");
    }

    #[test]
    fn dirty_matrix_buffer_is_sorted_and_drained() {
        let mut store = RenderStore::new("scene".to_string(), "home".to_string());
        for index in 0..3 {
            store.insert_entity(RenderEntity {
                id: format!("entity-{index}"),
                parent_id: None,
                instance_index: index,
                transform: Transform {
                    position: [index as f32, 0.0, 0.0],
                    rotation: [0.0, 0.0, 0.0],
                    scale: [1.0, 1.0, 1.0],
                },
                size: [100.0, 100.0],
                material_id: None,
                mesh_id: None,
                visible: true,
                locked: false,
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
    fn dirty_matrix_ranges_batch_contiguous_indices() {
        let payload = MatrixBufferPayload {
            instance_indices: vec![0, 1, 2, 5, 7, 8],
            matrices: (0..96).map(|value| value as f32).collect(),
        };

        let ranges = matrix_payload_to_ranges(payload);

        assert_eq!(ranges.len(), 3);
        assert_eq!(ranges[0].start_instance_index, 0);
        assert_eq!(ranges[0].count, 3);
        assert_eq!(ranges[0].matrices.len(), 48);
        assert_eq!(ranges[1].start_instance_index, 5);
        assert_eq!(ranges[1].count, 1);
        assert_eq!(ranges[2].start_instance_index, 7);
        assert_eq!(ranges[2].count, 2);
    }

    #[test]
    fn frame_state_does_not_drain_transform_dirty_set() {
        let mut store = RenderStore::new("scene".to_string(), "home".to_string());
        store.insert_entity(RenderEntity {
            id: "cube".to_string(),
            parent_id: None,
            instance_index: usize::MAX,
            transform: Transform::default(),
            size: [100.0, 100.0],
            material_id: None,
            mesh_id: None,
            visible: true,
            locked: false,
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
                parent_id: None,
                instance_index: index,
                transform: Transform {
                    position: [offset, offset * 0.5, offset * 0.25],
                    rotation: [offset * 0.001, offset * 0.002, offset * 0.003],
                    scale: [1.0, 1.0, 1.0],
                },
                size: [100.0, 100.0],
                material_id: None,
                mesh_id: None,
                visible: true,
                locked: false,
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
                parent_id: None,
                instance_index: index,
                transform: Transform {
                    position: [offset, offset * 0.5, offset * 0.25],
                    rotation: [offset * 0.001, offset * 0.002, offset * 0.003],
                    scale: [1.0, 1.0, 1.0],
                },
                size: [100.0, 100.0],
                material_id: None,
                mesh_id: None,
                visible: true,
                locked: false,
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
