# 7. 통합 상태 관리 및 동기화 시스템 계획

## 7.1 개요

통합 상태 관리는 아파트 단지의 "공용 시설 관리" 개념으로, 각 Unit(컨테이너)이 독립적으로 작동하면서도 필요한 상태를 안전하게 공유할 수 있는 시스템입니다.

### 핵심 목표
- **격리된 로컬 상태**: 각 Unit의 내부 상태는 완전히 격리
- **선택적 공유**: 명시적으로 공유된 상태만 다른 Unit과 동기화
- **실시간 동기화**: 상태 변경 시 즉시 관련 Unit들에 전파
- **충돌 해결**: 동시 수정 시 일관성 있는 충돌 해결

## 7.2 상태 계층 구조

### 7.2.1 상태 분류

```typescript
enum StateScope {
  // 완전 격리된 로컬 상태
  PRIVATE = 'private',           // Unit 내부 전용
  
  // 공유 상태
  BUILDING_SHARED = 'building',  // 같은 Building 내 Unit들과 공유
  APARTMENT_SHARED = 'apartment', // 전체 Apartment 내 Unit들과 공유
  GLOBAL_SHARED = 'global',      // 모든 Apartment와 공유
  
  // 특수 상태
  PERSISTENT = 'persistent',     // 브라우저 새로고침 후에도 유지
  EPHEMERAL = 'ephemeral'        // 세션 동안만 유지
}

interface StateDefinition {
  key: string
  scope: StateScope
  type: StateType
  schema: StateSchema
  conflictResolution: ConflictResolutionStrategy
  permissions: StatePermissions
  subscription: SubscriptionConfig
}

interface StateSchema {
  version: string
  properties: Record<string, PropertySchema>
  required: string[]
  migration?: (oldState: any, newVersion: string) => any
}
```

### 7.2.2 상태 매니저 아키텍처

```typescript
class UnifiedStateManager {
  private localStates: Map<string, StateStore>      // Unit별 로컬 상태
  private sharedStates: Map<string, SharedStateStore> // 공유 상태
  private wasmStateCore: WasmStateCore               // Rust/WASM 코어
  private syncChannel: StateSyncChannel             // 동기화 채널
  private conflictResolver: ConflictResolver         // 충돌 해결기
  
  constructor() {
    this.wasmStateCore = new WasmStateCore()
    this.syncChannel = new StateSyncChannel()
    this.conflictResolver = new ConflictResolver()
  }
  
  // Unit별 상태 스토어 생성
  createUnitStateStore(unitId: string): UnitStateStore {
    const store = new UnitStateStore(unitId, this)
    this.localStates.set(unitId, store)
    return store
  }
  
  // 공유 상태 등록
  registerSharedState(definition: StateDefinition): void {
    const sharedStore = new SharedStateStore(definition, this.wasmStateCore)
    this.sharedStates.set(definition.key, sharedStore)
    
    // 동기화 설정
    this.syncChannel.setupSync(definition.key, definition.scope)
  }
  
  // 상태 값 조회
  getState<T>(stateKey: string, unitId: string): T | undefined {
    // 1. 로컬 상태 확인
    const localStore = this.localStates.get(unitId)
    const localValue = localStore?.getLocal<T>(stateKey)
    if (localValue !== undefined) {
      return localValue
    }
    
    // 2. 공유 상태 확인
    const sharedStore = this.sharedStates.get(stateKey)
    return sharedStore?.getValue<T>(unitId)
  }
  
  // 상태 값 설정
  async setState<T>(
    stateKey: string, 
    value: T, 
    unitId: string,
    options: SetStateOptions = {}
  ): Promise<void> {
    const definition = this.getStateDefinition(stateKey)
    
    if (definition.scope === StateScope.PRIVATE) {
      // 로컬 상태 업데이트
      const localStore = this.localStates.get(unitId)!
      localStore.setLocal(stateKey, value)
    } else {
      // 공유 상태 업데이트
      await this.updateSharedState(stateKey, value, unitId, options)
    }
  }
}
```

## 7.3 WASM 기반 상태 코어

### 7.3.1 고성능 상태 엔진

```rust
// packages/core-rust/src/state_core.rs
use wasm_bindgen::prelude::*;
use std::collections::HashMap;
use serde::{Serialize, Deserialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StateEntry {
    pub key: String,
    pub value: serde_json::Value,
    pub version: u64,
    pub timestamp: f64,
    pub unit_id: String,
    pub scope: StateScope,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum StateScope {
    Private,
    BuildingShared,
    ApartmentShared,
    GlobalShared,
}

#[wasm_bindgen]
pub struct WasmStateCore {
    states: HashMap<String, StateEntry>,
    subscribers: HashMap<String, Vec<String>>, // state_key -> unit_ids
    version_counter: u64,
}

#[wasm_bindgen]
impl WasmStateCore {
    #[wasm_bindgen(constructor)]
    pub fn new() -> WasmStateCore {
        WasmStateCore {
            states: HashMap::new(),
            subscribers: HashMap::new(),
            version_counter: 0,
        }
    }
    
    #[wasm_bindgen]
    pub fn set_state(
        &mut self,
        key: &str,
        value: &JsValue,
        unit_id: &str,
        scope: &str
    ) -> Result<u64, JsValue> {
        // JSON으로 직렬화
        let json_value: serde_json::Value = serde_wasm_bindgen::from_value(value.clone())?;
        
        self.version_counter += 1;
        
        let entry = StateEntry {
            key: key.to_string(),
            value: json_value,
            version: self.version_counter,
            timestamp: js_sys::Date::now(),
            unit_id: unit_id.to_string(),
            scope: self.parse_scope(scope),
        };
        
        self.states.insert(key.to_string(), entry);
        
        // 구독자들에게 알림
        self.notify_subscribers(key, unit_id);
        
        Ok(self.version_counter)
    }
    
    #[wasm_bindgen]
    pub fn get_state(&self, key: &str) -> Result<JsValue, JsValue> {
        match self.states.get(key) {
            Some(entry) => serde_wasm_bindgen::to_value(&entry.value),
            None => Ok(JsValue::UNDEFINED)
        }
    }
    
    #[wasm_bindgen]
    pub fn subscribe(&mut self, state_key: &str, unit_id: &str) {
        self.subscribers
            .entry(state_key.to_string())
            .or_insert_with(Vec::new)
            .push(unit_id.to_string());
    }
    
    // 배치 업데이트 (성능 최적화)
    #[wasm_bindgen]
    pub fn batch_update(&mut self, updates: &JsValue) -> Result<Vec<u64>, JsValue> {
        let updates: Vec<StateUpdate> = serde_wasm_bindgen::from_value(updates.clone())?;
        let mut versions = Vec::new();
        
        for update in updates {
            match self.set_state(&update.key, &update.value, &update.unit_id, &update.scope) {
                Ok(version) => versions.push(version),
                Err(_) => continue,
            }
        }
        
        Ok(versions)
    }
    
    // 상태 스냅샷 생성
    #[wasm_bindgen]
    pub fn create_snapshot(&self) -> JsValue {
        let snapshot: HashMap<String, &StateEntry> = self.states.iter().collect();
        serde_wasm_bindgen::to_value(&snapshot).unwrap_or(JsValue::NULL)
    }
    
    // 스냅샷으로부터 복원
    #[wasm_bindgen]
    pub fn restore_from_snapshot(&mut self, snapshot: &JsValue) -> Result<(), JsValue> {
        let entries: HashMap<String, StateEntry> = serde_wasm_bindgen::from_value(snapshot.clone())?;
        
        for (key, entry) in entries {
            self.states.insert(key, entry);
        }
        
        Ok(())
    }
}
```

### 7.3.2 상태 동기화 채널

```typescript
class StateSyncChannel {
  private broadcastChannel: BroadcastChannel
  private webSocketConnection?: WebSocket
  private syncQueue: SyncOperation[] = []
  private isOnline: boolean = navigator.onLine
  
  constructor() {
    this.broadcastChannel = new BroadcastChannel('gaesup-state-sync')
    this.setupEventListeners()
    this.setupOfflineSync()
  }
  
  // 상태 변경 동기화
  async syncStateChange(
    stateKey: string,
    value: any,
    unitId: string,
    scope: StateScope
  ): Promise<void> {
    const operation: SyncOperation = {
      type: 'state_change',
      stateKey,
      value,
      unitId,
      scope,
      timestamp: Date.now(),
      version: this.generateVersion()
    }
    
    // 즉시 로컬 동기화 (같은 브라우저 탭/프레임)
    this.broadcastToLocal(operation)
    
    // 원격 동기화 (다른 브라우저/디바이스)
    if (this.shouldSyncRemotely(scope)) {
      await this.syncToRemote(operation)
    }
  }
  
  private broadcastToLocal(operation: SyncOperation): void {
    this.broadcastChannel.postMessage({
      type: 'sync_operation',
      operation,
      source: 'local'
    })
  }
  
  private async syncToRemote(operation: SyncOperation): Promise<void> {
    if (!this.isOnline) {
      // 오프라인 시 큐에 저장
      this.syncQueue.push(operation)
      return
    }
    
    try {
      if (this.webSocketConnection?.readyState === WebSocket.OPEN) {
        // WebSocket으로 실시간 동기화
        this.webSocketConnection.send(JSON.stringify({
          type: 'state_sync',
          operation
        }))
      } else {
        // HTTP API로 폴백
        await this.syncViaHTTP(operation)
      }
    } catch (error) {
      console.warn('Remote sync failed, queuing for retry:', error)
      this.syncQueue.push(operation)
    }
  }
  
  private setupOfflineSync(): void {
    window.addEventListener('online', async () => {
      this.isOnline = true
      await this.flushSyncQueue()
    })
    
    window.addEventListener('offline', () => {
      this.isOnline = false
    })
  }
  
  private async flushSyncQueue(): Promise<void> {
    while (this.syncQueue.length > 0) {
      const operation = this.syncQueue.shift()!
      try {
        await this.syncToRemote(operation)
      } catch (error) {
        // 실패한 작업은 다시 큐에 추가
        this.syncQueue.unshift(operation)
        break
      }
    }
  }
}
```

## 7.4 충돌 해결 전략

### 7.4.1 충돌 감지 및 해결

```typescript
class ConflictResolver {
  private resolutionStrategies: Map<string, ConflictStrategy> = new Map()
  
  constructor() {
    this.setupDefaultStrategies()
  }
  
  private setupDefaultStrategies(): void {
    // Last Write Wins (기본)
    this.resolutionStrategies.set('last_write_wins', {
      resolve: (current, incoming) => {
        return incoming.timestamp > current.timestamp ? incoming : current
      }
    })
    
    // First Write Wins
    this.resolutionStrategies.set('first_write_wins', {
      resolve: (current, incoming) => {
        return current.timestamp < incoming.timestamp ? current : incoming
      }
    })
    
    // 병합 전략 (객체 상태)
    this.resolutionStrategies.set('merge', {
      resolve: (current, incoming) => {
        if (typeof current.value === 'object' && typeof incoming.value === 'object') {
          return {
            ...current,
            value: { ...current.value, ...incoming.value },
            timestamp: Math.max(current.timestamp, incoming.timestamp)
          }
        }
        return incoming.timestamp > current.timestamp ? incoming : current
      }
    })
    
    // 수치 합산
    this.resolutionStrategies.set('sum', {
      resolve: (current, incoming) => {
        if (typeof current.value === 'number' && typeof incoming.value === 'number') {
          return {
            ...current,
            value: current.value + incoming.value,
            timestamp: Math.max(current.timestamp, incoming.timestamp)
          }
        }
        return incoming
      }
    })
    
    // 커스텀 해결 (사용자 개입)
    this.resolutionStrategies.set('user_resolve', {
      resolve: async (current, incoming) => {
        return await this.requestUserResolution(current, incoming)
      }
    })
  }
  
  async resolveConflict(
    stateKey: string,
    current: StateEntry,
    incoming: StateEntry[]
  ): Promise<StateEntry> {
    const definition = this.getStateDefinition(stateKey)
    const strategy = this.resolutionStrategies.get(definition.conflictResolution)
    
    if (!strategy) {
      throw new Error(`Unknown conflict resolution strategy: ${definition.conflictResolution}`)
    }
    
    let resolved = current
    
    for (const incomingEntry of incoming) {
      resolved = await strategy.resolve(resolved, incomingEntry)
    }
    
    return resolved
  }
  
  private async requestUserResolution(
    current: StateEntry,
    incoming: StateEntry
  ): Promise<StateEntry> {
    return new Promise((resolve) => {
      const modal = this.createConflictResolutionModal(current, incoming)
      modal.onResolve = (chosen: 'current' | 'incoming' | 'custom', customValue?: any) => {
        switch (chosen) {
          case 'current':
            resolve(current)
            break
          case 'incoming':
            resolve(incoming)
            break
          case 'custom':
            resolve({
              ...current,
              value: customValue,
              timestamp: Date.now()
            })
            break
        }
      }
      modal.show()
    })
  }
}
```

### 7.4.2 운영 충돌 최소화

```typescript
class OptimisticUpdateManager {
  private pendingUpdates: Map<string, PendingUpdate> = new Map()
  
  // 낙관적 업데이트 실행
  async optimisticUpdate<T>(
    stateKey: string,
    updater: (current: T) => T,
    unitId: string
  ): Promise<void> {
    const current = this.stateManager.getState<T>(stateKey, unitId)
    const optimisticValue = updater(current)
    
    // 즉시 로컬 UI 업데이트
    this.stateManager.setLocalState(stateKey, optimisticValue, unitId)
    
    // 원격 업데이트 시작
    const updateId = this.generateUpdateId()
    this.pendingUpdates.set(updateId, {
      stateKey,
      originalValue: current,
      optimisticValue,
      unitId,
      timestamp: Date.now()
    })
    
    try {
      // 서버에 실제 업데이트 요청
      await this.stateManager.setState(stateKey, optimisticValue, unitId, {
        updateId,
        optimistic: true
      })
      
      // 성공 시 pending 제거
      this.pendingUpdates.delete(updateId)
      
    } catch (error) {
      // 실패 시 원래 값으로 되돌리기
      this.stateManager.setLocalState(stateKey, current, unitId)
      this.pendingUpdates.delete(updateId)
      throw error
    }
  }
  
  // 서버 응답으로 낙관적 업데이트 검증
  validateOptimisticUpdate(
    updateId: string,
    serverValue: any
  ): boolean {
    const pending = this.pendingUpdates.get(updateId)
    if (!pending) return true
    
    // 서버 값과 낙관적 값이 다르면 수정
    if (!this.deepEqual(pending.optimisticValue, serverValue)) {
      this.stateManager.setLocalState(
        pending.stateKey,
        serverValue,
        pending.unitId
      )
      return false
    }
    
    return true
  }
}
```

## 7.5 프레임워크별 상태 바인딩

### 7.5.1 React 통합

```typescript
// React Hooks
export function useSharedState<T>(
  stateKey: string,
  defaultValue: T,
  options: UseSharedStateOptions = {}
): [T, (value: T | ((prev: T) => T)) => void, StateMetadata] {
  const [value, setValue] = useState<T>(defaultValue)
  const [metadata, setMetadata] = useState<StateMetadata>({ loading: false })
  const stateManager = useContext(StateManagerContext)
  const unitId = useContext(UnitContext).id
  
  useEffect(() => {
    // 초기값 로드
    const initialValue = stateManager.getState<T>(stateKey, unitId)
    if (initialValue !== undefined) {
      setValue(initialValue)
    }
    
    // 상태 변경 구독
    const unsubscribe = stateManager.subscribe(stateKey, (newValue, meta) => {
      setValue(newValue)
      setMetadata(meta)
    })
    
    return unsubscribe
  }, [stateKey, unitId])
  
  const updateState = useCallback((newValue: T | ((prev: T) => T)) => {
    const resolvedValue = typeof newValue === 'function' 
      ? (newValue as (prev: T) => T)(value)
      : newValue
    
    if (options.optimistic) {
      stateManager.optimisticUpdate(stateKey, () => resolvedValue, unitId)
    } else {
      stateManager.setState(stateKey, resolvedValue, unitId)
    }
  }, [stateKey, unitId, value, options.optimistic])
  
  return [value, updateState, metadata]
}

// 컨테이너 간 이벤트
export function useContainerEvent(
  eventName: string,
  handler: (data: any) => void,
  deps: any[] = []
): (data: any) => void {
  const eventBus = useContext(EventBusContext)
  const unitId = useContext(UnitContext).id
  
  useEffect(() => {
    const unsubscribe = eventBus.on(eventName, handler)
    return unsubscribe
  }, [eventName, ...deps])
  
  const emit = useCallback((data: any) => {
    eventBus.emit(eventName, data, { source: unitId })
  }, [eventName, unitId])
  
  return emit
}
```

### 7.5.2 Vue/Svelte 통합

```typescript
// Vue Composable
export function useSharedState<T>(
  stateKey: string,
  defaultValue: T,
  options: UseSharedStateOptions = {}
) {
  const state = ref<T>(defaultValue)
  const metadata = ref<StateMetadata>({ loading: false })
  const stateManager = inject('stateManager')!
  const unitId = inject('unitId')!
  
  onMounted(() => {
    const initialValue = stateManager.getState<T>(stateKey, unitId)
    if (initialValue !== undefined) {
      state.value = initialValue
    }
    
    const unsubscribe = stateManager.subscribe(stateKey, (newValue, meta) => {
      state.value = newValue
      metadata.value = meta
    })
    
    onUnmounted(unsubscribe)
  })
  
  const updateState = (newValue: T | ((prev: T) => T)) => {
    const resolvedValue = typeof newValue === 'function' 
      ? newValue(state.value)
      : newValue
    
    if (options.optimistic) {
      stateManager.optimisticUpdate(stateKey, () => resolvedValue, unitId)
    } else {
      stateManager.setState(stateKey, resolvedValue, unitId)
    }
  }
  
  return {
    state: readonly(state),
    updateState,
    metadata: readonly(metadata)
  }
}

// Svelte Store
export function createSharedStore<T>(
  stateKey: string,
  defaultValue: T,
  unitId: string
) {
  const { subscribe, set, update } = writable<T>(defaultValue)
  const stateManager = getStateManager()
  
  // 초기값 로드 및 구독 설정
  const initialValue = stateManager.getState<T>(stateKey, unitId)
  if (initialValue !== undefined) {
    set(initialValue)
  }
  
  const unsubscribe = stateManager.subscribe(stateKey, (newValue) => {
    set(newValue)
  })
  
  return {
    subscribe,
    set: (value: T) => stateManager.setState(stateKey, value, unitId),
    update: (updater: (value: T) => T) => 
      stateManager.optimisticUpdate(stateKey, updater, unitId),
    destroy: unsubscribe
  }
}
```

## 7.6 성능 최적화

### 7.6.1 선택적 구독

```typescript
class SelectiveSubscriptionManager {
  // 세밀한 구독 설정
  subscribeToPath<T>(
    stateKey: string,
    path: string,
    callback: (value: T) => void,
    unitId: string
  ): () => void {
    const fullPath = `${stateKey}.${path}`
    
    return this.stateManager.subscribe(stateKey, (state) => {
      const value = this.getNestedValue(state, path)
      callback(value)
    }, {
      filter: (oldState, newState) => {
        const oldValue = this.getNestedValue(oldState, path)
        const newValue = this.getNestedValue(newState, path)
        return !this.deepEqual(oldValue, newValue)
      }
    })
  }
  
  // 배치 구독 (성능 최적화)
  batchSubscribe(
    subscriptions: Array<{
      stateKey: string
      callback: (value: any) => void
    }>,
    unitId: string
  ): () => void {
    const unsubscribers: Array<() => void> = []
    
    // 동일한 상태에 대한 구독을 그룹화
    const groupedSubs = this.groupSubscriptionsByState(subscriptions)
    
    for (const [stateKey, callbacks] of groupedSubs) {
      const unsubscribe = this.stateManager.subscribe(stateKey, (value) => {
        // 한 번의 상태 변경으로 모든 콜백 실행
        callbacks.forEach(callback => callback(value))
      })
      
      unsubscribers.push(unsubscribe)
    }
    
    return () => unsubscribers.forEach(unsub => unsub())
  }
}
```

---

이 통합 상태 관리 시스템을 통해 **다중 프레임워크 환경에서도 일관되고 효율적인** 상태 공유가 가능하며, **실시간 동기화와 충돌 해결**로 데이터 무결성을 보장할 수 있습니다. 