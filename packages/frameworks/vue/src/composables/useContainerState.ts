import { ref, computed, onMounted, onUnmounted, watch, type Ref, type ComputedRef } from 'vue'
import type { ContainerInstance, ContainerConfig } from '@gaesup-state/core'
import { useContainerManager } from './useContainerManager'
import type { UseContainerStateOptions, UseContainerStateReturn } from '../types'

export function useContainerState<T = any>(
  containerName: string | Ref<string>,
  options: UseContainerStateOptions<T> = {}
): UseContainerStateReturn<T> {
  const {
    initialState,
    autoStart = true,
    containerConfig = {},
    onError,
    onStateChange,
    retryCount = 3,
    retryDelay = 1000
  } = options

  const manager = useContainerManager()
  
  // Reactive state
  const state = ref<T>(initialState as T) as Ref<T>
  const isLoading = ref(false)
  const error = ref<Error | null>(null)
  const container = ref<ContainerInstance | null>(null)
  
  // Retry logic
  const retryCountRef = ref(0)
  let unsubscribe: (() => void) | null = null

  // Computed container name (reactive)
  const containerNameValue = computed(() => 
    typeof containerName === 'string' ? containerName : containerName.value
  )

  // Start container
  const startContainer = async () => {
    if (!manager.value) return

    isLoading.value = true
    error.value = null

    try {
      const containerInstance = await manager.value.run(
        containerNameValue.value, 
        containerConfig
      )
      
      container.value = containerInstance
      
      // Set initial state
      if (initialState !== undefined) {
        await containerInstance.updateState(initialState)
      }
      
      // Subscribe to state changes
      unsubscribe = containerInstance.subscribe((newState) => {
        state.value = newState
        onStateChange?.(newState)
      })
      
      retryCountRef.value = 0
      
    } catch (err) {
      const errorInstance = err instanceof Error ? err : new Error('Container startup failed')
      error.value = errorInstance
      onError?.(errorInstance)

      // Retry logic
      if (retryCountRef.value < retryCount) {
        retryCountRef.value++
        setTimeout(() => {
          startContainer()
        }, retryDelay * retryCountRef.value)
      }
    } finally {
      isLoading.value = false
    }
  }

  // Stop container
  const stopContainer = async () => {
    if (container.value) {
      try {
        if (unsubscribe) {
          unsubscribe()
          unsubscribe = null
        }
        
        await container.value.stop()
        container.value = null
        state.value = initialState as T
      } catch (err) {
        console.error('Failed to stop container:', err)
      }
    }
  }

  // Call function
  const call = async <R = any>(functionName: string, args?: any): Promise<R> => {
    if (!container.value) {
      throw new Error('Container not available')
    }

    try {
      return await container.value.call<R>(functionName, args)
    } catch (err) {
      const errorInstance = err instanceof Error ? err : new Error('Function call failed')
      error.value = errorInstance
      onError?.(errorInstance)
      throw errorInstance
    }
  }

  // Update state
  const setState = async (newState: T | ((prev: T) => T)) => {
    if (!container.value) {
      throw new Error('Container not available')
    }

    try {
      const resolvedState = typeof newState === 'function' 
        ? (newState as (prev: T) => T)(state.value)
        : newState

      await container.value.updateState(resolvedState)
      state.value = resolvedState
      onStateChange?.(resolvedState)
    } catch (err) {
      const errorInstance = err instanceof Error ? err : new Error('State update failed')
      error.value = errorInstance
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
    if (container.value) {
      try {
        const currentState = container.value.state
        state.value = currentState
        onStateChange?.(currentState)
      } catch (err) {
        const errorInstance = err instanceof Error ? err : new Error('Refresh failed')
        error.value = errorInstance
        onError?.(errorInstance)
      }
    }
  }

  // Watch container name changes
  watch(containerNameValue, async (newName, oldName) => {
    if (newName !== oldName && container.value) {
      await restart()
    }
  })

  // Auto start
  onMounted(() => {
    if (autoStart && manager.value) {
      startContainer()
    }
  })

  // Cleanup
  onUnmounted(() => {
    if (unsubscribe) {
      unsubscribe()
    }
    if (container.value) {
      container.value.stop().catch(console.error)
    }
  })

  return {
    state: state as Ref<T>,
    isLoading: isLoading as Ref<boolean>,
    error: error as Ref<Error | null>,
    container: container as Ref<ContainerInstance | null>,
    call,
    setState,
    restart,
    refresh
  }
} 