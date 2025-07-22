// Hooks
export { useContainerState } from './hooks/useContainerState'
export { useContainerRegistry } from './hooks/useContainerRegistry'
export { useContainerMetrics } from './hooks/useContainerMetrics'
export { useContainerEvents } from './hooks/useContainerEvents'
export { useContainerManager } from './hooks/useContainerManager'

// Provider Components
export { ContainerProvider } from './components/ContainerProvider'
export { ContainerSuspense } from './components/ContainerSuspense'
export { ContainerErrorBoundary } from './components/ContainerErrorBoundary'

// Context
export { ContainerContext, useContainerContext } from './context/ContainerContext'

// Types
export type {
  UseContainerStateOptions,
  UseContainerStateResult,
  UseContainerRegistryResult,
  UseContainerMetricsOptions,
  ContainerProviderProps,
  ContainerSuspenseProps,
  ContainerErrorBoundaryProps
} from './types'

// Utilities
export { createContainer, validateContainer } from './utils'

// Version
export const VERSION = '1.0.0' 