import { writable, derived, get, type Writable, type Readable } from 'svelte/store'
import type { ContainerInstance, ContainerConfig } from '@gaesup-state/core'
import { getContainerManagerStore } from './managerStore'
import type { ContainerStore, ContainerStoreOptions } from '../types'

export function createContainerStore<T = any>(
  containerName: string,
  options: ContainerStoreOptions<T> = {}
): ContainerStore<T> {
  const {
    initialState,
    autoStart = true,
    containerConfig = {},
    onError,
    onStateChange,
    retryCount = 3,
    retryDelay = 1000
  } = options

  // Internal stores
  const state = writable<T>(initialState as T)
  const isLoading = writable(false)
  const error = writable<Error | null>(null)
  const container = writable<ContainerInstance | null>(null)
  const retryCountRef = { current: 0 }

  let unsubscribeContainer: (() => void) | null = null
  const managerStore = getContainerManagerStore()

  // Start container
  const startContainer = async () => {
    const manager = get(managerStore).manager
    if (!manager) return

    isLoading.set(true)
    error.set(null)

    try {
      const containerInstance = await manager.run(containerName, containerConfig)
      
      container.set(containerInstance)
      
      // Set initial state
      if (initialState !== undefined) {
        await containerInstance.updateState(initialState)
      }
      
      // Subscribe to state changes
      unsubscribeContainer = containerInstance.subscribe((newState) => {
        state.set(newState)
        onStateChange?.(newState)
      })
      
      retryCountRef.current = 0
      
    } catch (err) {
      const errorInstance = err instanceof Error ? err : new Error('Container startup failed')
      error.set(errorInstance)
      onError?.(errorInstance)

      // Retry logic
      if (retryCountRef.current < retryCount) {
        retryCountRef.current++
        setTimeout(() => {
          startContainer()
        }, retryDelay * retryCountRef.current)
      }
    } finally {
      isLoading.set(false)
    }
  }

  // Stop container
  const stopContainer = async () => {
    const containerInstance = get(container)
    if (containerInstance) {
      try {
        if (unsubscribeContainer) {
          unsubscribeContainer()
          unsubscribeContainer = null
        }
        
        await containerInstance.stop()
        container.set(null)
        state.set(initialState as T)
      } catch (err) {
        console.error('Failed to stop container:', err)
      }
    }
  }

  // Call function
  const call = async <R = any>(functionName: string, args?: any): Promise<R> => {
    const containerInstance = get(container)
    if (!containerInstance) {
      throw new Error('Container not available')
    }

    try {
      return await containerInstance.call<R>(functionName, args)
    } catch (err) {
      const errorInstance = err instanceof Error ? err : new Error('Function call failed')
      error.set(errorInstance)
      onError?.(errorInstance)
      throw errorInstance
    }
  }

  // Update state
  const setState = async (newState: T | ((prev: T) => T)) => {
    const containerInstance = get(container)
    if (!containerInstance) {
      throw new Error('Container not available')
    }

    try {
      const currentState = get(state)
      const resolvedState = typeof newState === 'function' 
        ? (newState as (prev: T) => T)(currentState)
        : newState

      await containerInstance.updateState(resolvedState)
      state.set(resolvedState)
      onStateChange?.(resolvedState)
    } catch (err) {
      const errorInstance = err instanceof Error ? err : new Error('State update failed')
      error.set(errorInstance)
      onError?.(errorInstance)
      throw errorInstance
    }
  }

  // Restart container
  const restart = async () => {
    await stopContainer()
    await startContainer()
  }

  // Refresh state
  const refresh = async () => {
    const containerInstance = get(container)
    if (containerInstance) {
      try {
        const currentState = containerInstance.state
        state.set(currentState)
        onStateChange?.(currentState)
      } catch (err) {
        const errorInstance = err instanceof Error ? err : new Error('Refresh failed')
        error.set(errorInstance)
        onError?.(errorInstance)
      }
    }
  }

  // Subscribe to manager changes for auto start
  if (autoStart) {
    managerStore.subscribe(({ manager, isInitialized }) => {
      if (manager && isInitialized && !get(container) && !get(isLoading)) {
        startContainer()
      }
    })
  }

  // Derived store for convenient access
  const derivedStore = derived(
    [state, isLoading, error, container],
    ([$state, $isLoading, $error, $container]) => ({
      state: $state,
      isLoading: $isLoading,
      error: $error,
      container: $container
    })
  )

  return {
    // Readable stores
    subscribe: derivedStore.subscribe,
    state: { subscribe: state.subscribe },
    isLoading: { subscribe: isLoading.subscribe },
    error: { subscribe: error.subscribe },
    container: { subscribe: container.subscribe },
    
    // Actions
    call,
    setState,
    restart,
    refresh,
    start: startContainer,
    stop: stopContainer,
    
    // Cleanup
    destroy: () => {
      if (unsubscribeContainer) {
        unsubscribeContainer()
      }
      const containerInstance = get(container)
      if (containerInstance) {
        containerInstance.stop().catch(console.error)
      }
    }
  }
}

// Store cache for reusing containers
const storeCache = new Map<string, ContainerStore<any>>()

export function getContainerStore<T = any>(
  containerName: string,
  options?: ContainerStoreOptions<T>
): ContainerStore<T> {
  const cacheKey = `${containerName}-${JSON.stringify(options)}`
  
  if (storeCache.has(cacheKey)) {
    return storeCache.get(cacheKey)!
  }
  
  const store = createContainerStore(containerName, options)
  storeCache.set(cacheKey, store)
  
  return store
} 