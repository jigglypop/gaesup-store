// Vue Composition API hooks
export { useContainerState } from './composables/useContainerState'
export { useContainerManager } from './composables/useContainerManager'
export { useContainerMetrics } from './composables/useContainerMetrics'
export { useContainerEvents } from './composables/useContainerEvents'

// Plugin
export { GaesupStatePlugin } from './plugin/GaesupStatePlugin'

// Directives
export { vContainer } from './directives/container'

// Utilities
export { createGaesupApp } from './utils/createApp'

// Types
export type {
  UseContainerStateOptions,
  UseContainerStateReturn,
  ContainerDirectiveBinding,
  GaesupStatePluginOptions
} from './types'

// Version
export const VERSION = '1.0.0' 