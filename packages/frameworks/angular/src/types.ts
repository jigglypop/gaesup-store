import type { ContainerConfig, ContainerManagerConfig } from 'gaesup-state'

export interface ContainerServiceConfig<T = any> {
  initialState?: T
  autoStart?: boolean
  containerConfig?: ContainerConfig
  onError?: (error: Error) => void
  onStateChange?: (state: T) => void
  retryCount?: number
  retryDelay?: number
}

export interface ContainerSignalOptions<T = any> extends ContainerServiceConfig<T> {}
export interface GaesupStateModuleConfig extends ContainerManagerConfig {}
