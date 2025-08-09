/**
 * 🚀 Vue용 통합 Gaesup Composable
 * 공통 패턴 기반의 Vue 전용 래퍼
 */

import { ref, reactive, onUnmounted, watch, type Ref } from 'vue'
import { createGaesupManager, type GaesupState, type ContainerConfig } from '@gaesup-state/core'

export interface UseUnifiedGaesupOptions<T> {
  initialState: T
  config?: ContainerConfig
  autoCleanup?: boolean
}

export interface UseUnifiedGaesupReturn<T> {
  state: Ref<GaesupState<T>>
  actions: {
    set: (newState: T) => Promise<void>
    merge: (partialState: Partial<T>) => Promise<void>
    update: (path: string, value: any) => Promise<void>
    reset: () => Promise<void>
    snapshot: () => string
    restore: (snapshotId: string) => Promise<void>
  }
  manager: ReturnType<typeof createGaesupManager>
}

/**
 * 🎯 모든 프레임워크와 동일한 패턴을 Vue에서 사용
 */
export function useUnifiedGaesup<T = any>(
  options: UseUnifiedGaesupOptions<T>
): UseUnifiedGaesupReturn<T> {
  const { initialState, config, autoCleanup = true } = options
  
  // Manager 인스턴스 생성
  const manager = createGaesupManager(initialState, config)
  
  // Vue reactive state
  const state = ref<GaesupState<T>>(manager.state)
  
  // 구독 설정
  const unsubscribe = manager.subscribe((newState) => {
    state.value = newState
  })
  
  // 자동 정리
  if (autoCleanup) {
    onUnmounted(() => {
      unsubscribe()
      manager.cleanup()
    })
  }
  
  return {
    state,
    actions: manager.actions,
    manager
  }
}

/**
 * 🎯 간단한 상태 관리용 (기본 타입)
 */
export function useGaesupState<T = any>(initialState: T) {
  return useUnifiedGaesup({ initialState })
}

/**
 * 🎯 Reactive한 배치 업데이트용
 */
export function useGaesupBatch() {
  const updates = ref<Array<{ path: string; value: any }>>([])
  
  const addUpdate = (path: string, value: any) => {
    updates.value.push({ path, value })
  }
  
  const clearUpdates = () => {
    updates.value = []
  }
  
  const executeBatch = async () => {
    if (updates.value.length === 0) return
    
    const { batchUpdate } = await import('@gaesup-state/core')
    const result = await batchUpdate(updates.value)
    clearUpdates()
    return result
  }
  
  return {
    updates,
    addUpdate,
    clearUpdates,
    executeBatch
  }
}

/**
 * 🎯 감시자와 함께 사용하는 패턴
 */
export function useGaesupWatcher<T = any>(
  initialState: T,
  watcher: (newState: T, oldState: T) => void
) {
  const { state, actions, manager } = useUnifiedGaesup({ initialState })
  
  watch(
    () => state.value.data,
    (newData, oldData) => {
      if (newData !== oldData) {
        watcher(newData, oldData)
      }
    },
    { deep: true }
  )
  
  return { state, actions, manager }
} 