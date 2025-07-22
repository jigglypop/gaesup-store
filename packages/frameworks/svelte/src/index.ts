// Svelte stores
export { createContainerStore } from './stores/containerStore'
export { createContainerManagerStore } from './stores/managerStore'
export { createContainerMetricsStore } from './stores/metricsStore'

// Actions
export { container } from './actions/container'
export { metrics } from './actions/metrics'

// Utilities
export { wrappedContainer } from './utils/wrappedContainer'
export { derivedContainer } from './utils/derivedContainer'

// Components (re-export)
export { default as ContainerProvider } from './components/ContainerProvider.svelte'
export { default as ContainerError } from './components/ContainerError.svelte'

// Types
export type {
  ContainerStore,
  ContainerStoreOptions,
  ContainerManagerStore,
  MetricsStore,
  ContainerActionOptions
} from './types'

// Version
export const VERSION = '1.0.0' 