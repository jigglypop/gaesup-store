import type { Readable } from 'svelte/store'
import type { ContainerConfig, ContainerInstance } from '@gaesup-state/core'

export interface ContainerStoreOptions<T> {
  initialState?: T
  autoStart?: boolean
  containerConfig?: ContainerConfig
  onError?: (error: Error) => void
  onStateChange?: (state: T) => void
  retryCount?: number
  retryDelay?: number
}

export interface ContainerStore<T> extends Readable<{
  state: T
  isLoading: boolean
  error: Error | null
  container: ContainerInstance | null
}> {
  state: Readable<T>
  isLoading: Readable<boolean>
  error: Readable<Error | null>
  container: Readable<ContainerInstance | null>
  call: <R = any>(functionName: string, args?: any) => Promise<R>
  setState: (state: T | ((prev: T) => T)) => Promise<void>
  restart: () => Promise<void>
  refresh: () => Promise<void>
  start: () => Promise<void>
  stop: () => Promise<void>
  destroy: () => void
}

export interface ContainerManagerStore {}
export interface MetricsStore {}
export interface ContainerActionOptions {}
