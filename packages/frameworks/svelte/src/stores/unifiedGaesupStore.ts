/**
 * 🚀 Svelte용 통합 Gaesup Store
 * 공통 패턴 기반의 Svelte 전용 래퍼
 */

import { writable, type Writable } from 'svelte/store'
import { createGaesupManager, type GaesupState, type ContainerConfig } from '@gaesup-state/core'

export interface UnifiedGaesupStoreOptions<T> {
  initialState: T
  config?: ContainerConfig
}

export interface UnifiedGaesupStore<T> {
  subscribe: Writable<GaesupState<T>>['subscribe']
  actions: {
    set: (newState: T) => Promise<void>
    merge: (partialState: Partial<T>) => Promise<void>
    update: (path: string, value: any) => Promise<void>
    reset: () => Promise<void>
    snapshot: () => string
    restore: (snapshotId: string) => Promise<void>
  }
  manager: ReturnType<typeof createGaesupManager>
  cleanup: () => void
}

/**
 * 🎯 모든 프레임워크와 동일한 패턴을 Svelte에서 사용
 */
export function createUnifiedGaesupStore<T = any>(
  options: UnifiedGaesupStoreOptions<T>
): UnifiedGaesupStore<T> {
  const { initialState, config } = options
  
  // Manager 인스턴스 생성
  const manager = createGaesupManager(initialState, config)
  
  // Svelte writable store 생성
  const { subscribe, set } = writable<GaesupState<T>>(manager.state)
  
  // Manager와 Store 연결
  const unsubscribe = manager.subscribe((newState) => {
    set(newState)
  })
  
  return {
    subscribe,
    actions: manager.actions,
    manager,
    cleanup: () => {
      unsubscribe()
      manager.cleanup()
    }
  }
}

/**
 * 🎯 간단한 상태 관리용 (기본 타입)
 */
export function createGaesupState<T = any>(initialState: T) {
  return createUnifiedGaesupStore({ initialState })
}

/**
 * 🎯 배치 업데이트용 스토어
 */
export function createGaesupBatchStore() {
  const { subscribe, update } = writable<Array<{ path: string; value: any }>>([])
  
  const addUpdate = (path: string, value: any) => {
    update(updates => [...updates, { path, value }])
  }
  
  const clearUpdates = () => {
    update(() => [])
  }
  
  const executeBatch = async () => {
    let currentUpdates: Array<{ path: string; value: any }> = []
    
    const unsubscribe = subscribe(updates => {
      currentUpdates = updates
    })()
    
    if (currentUpdates.length === 0) return
    
    const { batchUpdate } = await import('@gaesup-state/core')
    const result = await batchUpdate(currentUpdates)
    clearUpdates()
    return result
  }
  
  return {
    subscribe,
    addUpdate,
    clearUpdates,
    executeBatch
  }
}

/**
 * 🎯 파생된 상태를 위한 스토어
 */
export function createDerivedGaesupStore<T, R>(
  baseStore: UnifiedGaesupStore<T>,
  deriveFn: (state: GaesupState<T>) => R
) {
  const { subscribe } = writable<R | null>(null)
  
  let currentValue: R | null = null
  
  const unsubscribe = baseStore.subscribe(state => {
    const newValue = deriveFn(state)
    if (newValue !== currentValue) {
      currentValue = newValue
      subscribe.set?.(newValue)
    }
  })
  
  return {
    subscribe,
    cleanup: unsubscribe
  }
} 