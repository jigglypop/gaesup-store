// Services
export { ContainerService } from './services/container.service'
export { ContainerManagerService } from './services/container-manager.service'

// Signals
export { createContainerSignal } from './signals/container-signal'
export { createContainerMetricsSignal } from './signals/metrics-signal'

// Directives
export { ContainerDirective } from './directives/container.directive'

// Pipes
export { ContainerStatePipe } from './pipes/container-state.pipe'
export { ContainerMetricsPipe } from './pipes/container-metrics.pipe'

// Module
export { GaesupStateModule } from './gaesup-state.module'

// Standalone providers
export { 
  provideGaesupState,
  provideContainerManager,
  GAESUP_STATE_CONFIG 
} from './providers'

// Types
export type {
  ContainerSignalOptions,
  ContainerServiceConfig,
  GaesupStateModuleConfig
} from './types'

// Version
export const VERSION = '1.0.0' 