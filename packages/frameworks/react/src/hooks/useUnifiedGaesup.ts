/**
 * 🚀 React용 통합 Gaesup 훅
 * 공통 패턴 기반의 React 전용 래퍼
 */

import { useState, useEffect, useRef, useMemo } from 'react'
import { createGaesupManager, type GaesupState, type ContainerConfig } from '@gaesup-state/core'

export interface UseUnifiedGaesupOptions<T> {
  initialState: T
  config?: ContainerConfig
  autoCleanup?: boolean // 컴포넌트 언마운트시 자동 정리
}

export interface UseUnifiedGaesupReturn<T> {
  state: GaesupState<T>
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
 * 🎯 모든 프레임워크와 동일한 패턴을 React에서 사용
 */
export function useUnifiedGaesup<T = any>(
  options: UseUnifiedGaesupOptions<T>
): UseUnifiedGaesupReturn<T> {
  const { initialState, config, autoCleanup = true } = options
  
  // Manager 인스턴스 생성 (한 번만)
  const manager = useMemo(
    () => createGaesupManager(initialState, config),
    [initialState, config]
  )
  
  // React state로 관리
  const [state, setState] = useState<GaesupState<T>>(manager.state)
  const unsubscribeRef = useRef<(() => void) | null>(null)
  
  // 구독 설정
  useEffect(() => {
    unsubscribeRef.current = manager.subscribe((newState) => {
      setState(newState)
    })
    
    return () => {
      if (unsubscribeRef.current) {
        unsubscribeRef.current()
        unsubscribeRef.current = null
      }
    }
  }, [manager])
  
  // 자동 정리
  useEffect(() => {
    if (!autoCleanup) return
    
    return () => {
      manager.cleanup()
    }
  }, [manager, autoCleanup])
  
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
 * 🎯 배치 업데이트용 훅
 */
export function useGaesupBatch() {
  const [updates, setUpdates] = useState<Array<{ path: string; value: any }>>([])
  
  const addUpdate = (path: string, value: any) => {
    setUpdates(prev => [...prev, { path, value }])
  }
  
  const clearUpdates = () => {
    setUpdates([])
  }
  
  const executeBatch = async () => {
    if (updates.length === 0) return
    
    const { batchUpdate } = await import('@gaesup-state/core')
    const result = await batchUpdate(updates)
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