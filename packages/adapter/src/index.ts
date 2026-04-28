export {
  createAngularAdapter,
  createFrameworkAdapter,
  createReactAdapter,
  createSvelteAdapter,
  createVueAdapter
} from './FrameworkAdapter'
export { createReactiveState, createReactiveValue, createStore } from './reactive'
export { createSignal, createSignalValue } from './signals'
export { createReactivityBridge, createSyncChannel, StateSynchronizer } from './sync'
export { createUniversalContainer, UniversalContainer } from './container'

export type {
  AdapterContainerInstance,
  AdapterSubscription,
  EqualityFn,
  FrameworkAdapter,
  ReactiveValue,
  ReactivityBridge,
  ReactivitySystem,
  SignalValue,
  StateSubscription,
  StoreState,
  SubscribeOptions,
  SyncChannel,
  UniversalContainerInterface,
  Unsubscribe
} from './types'

export const VERSION = '1.0.0' 