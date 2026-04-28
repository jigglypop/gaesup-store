import type { Ref } from 'vue'
import type { ContainerConfig, ContainerInstance } from 'gaesup-state'

export interface UseContainerStateOptions<T> {
  initialState?: T
  autoStart?: boolean
  containerConfig?: ContainerConfig
  onError?: (error: Error) => void
  onStateChange?: (state: T) => void
  retryCount?: number
  retryDelay?: number
}

export interface UseContainerStateReturn<T> {
  state: Ref<T>
  isLoading: Ref<boolean>
  error: Ref<Error | null>
  container: Ref<ContainerInstance | null>
  call: <R = any>(functionName: string, args?: any) => Promise<R>
  setState: (state: T | ((prev: T) => T)) => Promise<void>
  restart: () => Promise<void>
  refresh: () => Promise<void>
}

export interface ContainerDirectiveBinding {
  value?: unknown
}

export interface GaesupStatePluginOptions {
  registry?: string
}
