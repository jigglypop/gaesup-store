// Framework-agnostic adapters
export { createFrameworkAdapter } from './FrameworkAdapter'

// 나머지는 추후 구현 예정
// TODO: 아래 모듈들은 아직 구현되지 않았습니다
// export { createReactiveState } from './reactive/ReactiveState'
// export { createSignal } from './signals/Signal'
// export { createStore } from './store/Store'
// export { createReactivityBridge } from './bridges/ReactivityBridge'
// export { createEventBridge } from './bridges/EventBridge'
// export { UniversalContainer } from './UniversalContainer'
// export { StateSynchronizer } from './sync/StateSynchronizer'
// export { createSyncChannel } from './sync/SyncChannel'

// Types - 임시로 기본 타입들만 정의
export type FrameworkAdapter = any
export type ReactiveValue = any
export type SignalValue = any
export type StoreState = any
export type SyncChannel = any
export type ReactivityBridge = any
export type UniversalContainerInterface = any

// Version
export const VERSION = '1.0.0' 