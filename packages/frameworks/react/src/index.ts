// Hooks
export { useContainerState } from './hooks/useContainerState'

// Provider Components
export { ContainerProvider } from './components/ContainerProvider'
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

// 🚀 통합 패턴 (React 전용 래퍼)
export { useUnifiedGaesup, useGaesupBatch } from './hooks/useUnifiedGaesup'

// Version
export const VERSION = '1.0.0' 